using System.Text.Json;
using System.Text.RegularExpressions;
using AuthService.Application.DTOs;
using AuthService.Application.Events;
using AuthService.Application.Exceptions;
using AuthService.Application.Remotes;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Remotes;
using AuthService.Options;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace AuthService.Application.Services;

/// <summary>
/// Registering, editing and retiring the remote micro-frontends the host mounts, plus the capability
/// discovery that keeps each one's permission feature in step with what the remote actually declares.
/// </summary>
/// <remarks>
/// <para>
/// This was the Module Registry, a separate service with a separate database that pushed its results
/// into AuthService over HTTP. Everything it did across that boundary now happens in one transaction
/// against one database, which removes a whole class of bug rather than merely relocating it: there is
/// no window in which the registration is saved and the permission sync has not landed, no local
/// capability cache that can disagree with the catalog, and no "the app that got displaced by a
/// display-order swap must ALSO be pushed" rule to forget.
/// </para>
/// <para>
/// The one guarantee that did NOT come for free is "an unreachable remote keeps its last-known
/// capabilities". That used to be an accident of round-tripping a cached copy back through the
/// reconciler. It is now an explicit contract: discovery answers null when it could not read the
/// remote, and null flows through <see cref="RemoteFeatureRequestBuilder"/> to
/// <see cref="PermissionCatalogAppService"/>, which leaves the stored set alone. That is strictly
/// stronger than the cache was — a cache could itself be stale and re-push a wrong set; a null cannot.
/// </para>
/// </remarks>
public partial class RemoteAppAppService(
    AuthDbContext db,
    PermissionCatalogAppService catalog,
    RemoteCapabilityDiscoveryClient discovery,
    RemoteManifestClient manifestClient,
    ApprovalGatingService gating,
    AuditLogAppService auditLog,
    ILogger<RemoteAppAppService> logger,
    IOptions<RemoteAppsOptions>? remoteAppsOptions = null,
    IPlatformEventPublisher? events = null)
{
    /// <summary>Absolute manifest URLs are a development convenience; see <see cref="RemoteAppsOptions.AllowAbsoluteManifestUrls"/>.</summary>
    private bool AllowAbsoluteManifestUrls => remoteAppsOptions?.Value.AllowAbsoluteManifestUrls ?? true;

    /// <summary>
    /// Identical to <see cref="CreateRemoteAppRequest.Key"/>'s annotation, and the error text below
    /// is the same sentence. The annotation runs first for a bound request; this catches a caller that
    /// reached the service another way (an approval replay, a seeder) and must answer the same.
    /// </summary>
    [GeneratedRegex("^[a-z][a-z0-9-]{1,49}$")]
    private static partial Regex KeyPattern();

    private const string KeyRuleMessage =
        "Application key must be 2-50 characters, start with a lowercase letter, and contain only "
        + "lowercase letters, digits and hyphens.";

    private const string ServiceName = "AuthService";
    private const string EntityType = "RemoteApp";

    // ── Reads ────────────────────────────────────────────────────────────────────

    public async Task<PagedResult<RemoteAppDto>> ListAsync(
        int page, int pageSize, string? search, CancellationToken ct = default)
    {
        var query = db.RemoteApps.AsNoTracking().Include(a => a.Feature).AsQueryable();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLowerInvariant();
            query = query.Where(a => a.Feature!.DisplayName.ToLower().Contains(term) || a.Key.ToLower().Contains(term));
        }

        var total = await query.CountAsync(ct);
        var items = await query
            .OrderBy(a => a.Feature!.SortOrder).ThenBy(a => a.Feature!.DisplayName)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(ct);

        return new PagedResult<RemoteAppDto>(items.Select(ToDto).ToList(), total, page, pageSize);
    }

    public async Task<RemoteAppDto> GetAsync(Guid id, CancellationToken ct = default)
    {
        var app = await db.RemoteApps.AsNoTracking().Include(a => a.Feature)
            .FirstOrDefaultAsync(a => a.FeatureId == id, ct) ?? throw NotFound(id);
        return ToDto(app);
    }

    /// <summary>
    /// Real reachability of every registered, non-Disabled app — what the host dashboard's health
    /// panel renders and what labels remote permissions elsewhere in the shell. Values come straight
    /// from the background probe; nothing is inferred, and an app not yet probed reports Unknown.
    /// </summary>
    public async Task<IReadOnlyList<HealthEntryDto>> GetHealthAsync(
        bool isAdministrator, IReadOnlySet<string> permissions, CancellationToken ct = default)
    {
        var apps = await db.RemoteApps
            .AsNoTracking()
            .Include(a => a.Feature)
            .Where(a => a.Status != RemoteAppStatus.Disabled)
            .OrderBy(a => a.Feature!.SortOrder).ThenBy(a => a.Feature!.DisplayName)
            .ToListAsync(ct);

        // The same visibility rule the sidebar uses: this feed must never reveal the existence of an
        // app the caller holds no capability on.
        var visible = isAdministrator
            ? apps
            : apps.Where(a => HasAnyPermissionFor(permissions, a.Feature!.Key)).ToList();

        return visible
            .Select(a => new HealthEntryDto(
                a.Key, a.Feature!.DisplayName, a.Health.ToString(), a.LastHealthCheckAt, a.LastHealthError))
            .ToList();
    }

    // ── Writes ───────────────────────────────────────────────────────────────────

    public async Task<MutationResult<RemoteAppDto>> CreateAsync(
        CreateRemoteAppRequest request, Guid? actingUserId, string? actorName,
        CancellationToken ct = default, bool bypassApproval = false)
    {
        var key = request.Key.Trim().ToLowerInvariant();
        if (!KeyPattern().IsMatch(key))
        {
            throw new ValidationAppException(KeyRuleMessage);
        }

        if (key == ReleaseRecord.HostKey)
        {
            throw new ValidationAppException("'host' is reserved for the platform shell and cannot be an application key.");
        }

        var featureKey = ToFeatureKey(key);

        if (await db.RemoteApps.AnyAsync(a => a.Key == key, ct))
        {
            throw new ConflictAppException($"A remote app with key '{key}' already exists.");
        }

        var manifestUrl = ManifestUrlPolicy.Normalize(request.ManifestUrl, key, AllowAbsoluteManifestUrls);
        var sourceUrl = OptionalHttpUrl(request.PermissionsSourceUrl, "PermissionsSourceUrl must be an absolute http or https URL.");
        var displayName = request.DisplayName.Trim();

        // Probe the manifest before accepting the registration. This turns two failure modes that
        // previously only appeared as a runtime error in the user's browser into an immediate,
        // actionable message on the registration form.
        var probe = await manifestClient.ProbeAsync(manifestUrl, ct);

        if (probe.ContainerName is not null)
        {
            // The Module Federation container name is a GLOBAL identifier in the browser. Two remotes
            // sharing one would overwrite each other's container at runtime, producing a bewildering
            // "wrong app rendered" bug. There is a unique index behind this now, but the check stays:
            // it names the offending app instead of surfacing a raw constraint violation.
            var clash = await db.RemoteApps.AsNoTracking().Include(a => a.Feature)
                .FirstOrDefaultAsync(a => a.ContainerName == probe.ContainerName, ct);

            if (clash is not null)
            {
                throw new ConflictAppException(
                    $"'{clash.Feature!.DisplayName}' ({clash.Key}) is already registered with the Module Federation "
                    + $"container name '{probe.ContainerName}'. Two remote apps cannot share a container name — "
                    + "rename this app's federation 'name' in its vite config and rebuild it.");
            }
        }

        var proposed = new RemoteAppSnapshotDto(
            key, displayName, request.IconKey?.Trim(), manifestUrl, sourceUrl,
            request.SidebarOrder, nameof(RemoteAppStatus.Active), null);

        var pending = await TrySubmitForApprovalAsync(
            // A Create has no id yet, so it supplies the app key — already validated as unique — as the
            // dedupe key. Without it the guarantee is inert for Creates: the key falls back to a null
            // entity id, and Postgres treats NULLs as distinct.
            ApprovalActionKeys.Create, entityId: null, displayName,
            oldDataJson: null, proposed, actingUserId, bypassApproval, ct, entityKey: $"remoteapp:{key}");

        if (pending is not null)
        {
            return MutationResult<RemoteAppDto>.PendingApproval(pending);
        }

        var now = DateTimeOffset.UtcNow;

        // The feature comes first: the registration hangs off its id. Created here rather than left to
        // the capability sync so the row exists even for an app whose remote is unreachable.
        var feature = new PermissionFeature
        {
            Id = Guid.NewGuid(),
            Key = featureKey,
            DisplayName = displayName,
            Source = PermissionFeatureSource.RemoteApp,
            IsActive = true,
            SortOrder = request.SidebarOrder,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.PermissionFeatures.Add(feature);

        db.RemoteApps.Add(new RemoteApp
        {
            FeatureId = feature.Id,
            Key = key,
            IconKey = request.IconKey?.Trim(),
            ManifestUrl = manifestUrl,
            PermissionsSourceUrl = sourceUrl,
            Status = RemoteAppStatus.Active,
            // Seed health from the probe just run so the app has a real status immediately, rather
            // than showing Unknown until the next background sweep.
            Health = probe.Health,
            LastHealthCheckAt = now,
            LastHealthError = probe.Error,
            ContainerName = probe.ContainerName,
            CreatedAt = now,
            UpdatedAt = now,
            CreatedBy = actingUserId,
            UpdatedBy = actingUserId,
        });

        await db.SaveChangesAsync(ct);

        await SyncCapabilitiesAsync(featureKey, displayName, request.SidebarOrder, sourceUrl, ct);

        await auditLog.WriteHostAsync(
            actingUserId, actorName, "remoteapp.created",
            AuditLogAppService.Modules.Applications, AuditLogAppService.Categories.Crud,
            entityType: EntityType, entityId: feature.Id.ToString(), details:
            $"Registered remote app '{displayName}' ({key}).", entityLabel: displayName, ct: ct);

        return MutationResult<RemoteAppDto>.Ok(await ReadDtoAsync(feature.Id, ct));
    }

    public async Task<MutationResult<RemoteAppDto>> UpdateAsync(
        Guid id, UpdateRemoteAppRequest request, Guid? actingUserId, string? actorName,
        CancellationToken ct = default, bool bypassApproval = false)
    {
        var app = await db.RemoteApps.Include(a => a.Feature).FirstOrDefaultAsync(a => a.FeatureId == id, ct)
            ?? throw NotFound(id);

        var manifestUrl = ManifestUrlPolicy.Normalize(request.ManifestUrl, app.Key, AllowAbsoluteManifestUrls);
        var newSourceUrl = OptionalHttpUrl(request.PermissionsSourceUrl, "PermissionsSourceUrl must be an absolute http or https URL.");
        var displayName = request.DisplayName.Trim();

        var proposed = new RemoteAppSnapshotDto(
            app.Key, displayName, request.IconKey?.Trim(), manifestUrl, newSourceUrl,
            request.SidebarOrder, app.Status.ToString(), app.MaintenanceMessage);

        var pending = await TrySubmitForApprovalAsync(
            ApprovalActionKeys.Update, id.ToString(), app.Feature!.DisplayName,
            JsonSerializer.Serialize(Snapshot(app)), proposed, actingUserId, bypassApproval, ct);

        if (pending is not null)
        {
            return MutationResult<RemoteAppDto>.PendingApproval(pending);
        }

        /*
         * Moving an app to a position another app already holds SWAPS the two.
         *
         * Sidebar order is a plain int with no unique constraint, so two apps could sit on the same
         * number; the list queries then fell back to ThenBy(DisplayName), which is deterministic but
         * means the position an admin typed did not decide anything. Worse, there was no way to
         * reorder in one action — putting Lead Management first meant editing it AND editing whatever
         * already held position 1.
         *
         * Swapping makes a single edit express the whole intent ("put this one first, the other takes
         * this one's old slot"), touches exactly two rows, and keeps positions unique as long as they
         * started unique. If several apps already share a number (data from before this rule), only
         * the first is moved — the rest are left alone rather than silently renumbered.
         *
         * The order lives on the permission feature, so the swap is two feature rows and no push:
         * there is no second database that could end up disagreeing about who sits where.
         */
        var previousOrder = app.Feature.SortOrder;
        if (request.SidebarOrder != previousOrder)
        {
            var occupantFeatureIds = await db.RemoteApps
                .Where(a => a.FeatureId != app.FeatureId)
                .Select(a => a.FeatureId)
                .ToListAsync(ct);

            var occupant = await db.PermissionFeatures
                .Where(f => occupantFeatureIds.Contains(f.Id) && f.SortOrder == request.SidebarOrder)
                .OrderBy(f => f.DisplayName)
                .FirstOrDefaultAsync(ct);

            if (occupant is not null)
            {
                occupant.SortOrder = previousOrder;
                occupant.UpdatedAt = DateTimeOffset.UtcNow;
            }
        }

        var now = DateTimeOffset.UtcNow;

        app.Feature.DisplayName = displayName;
        app.Feature.SortOrder = request.SidebarOrder;
        app.Feature.UpdatedAt = now;

        // A new manifest URL is a new build being put in front of users, so it is held to the same
        // checks as a release promotion: it must be readable, and it must be the same app.
        var repointed = !string.Equals(app.ManifestUrl, manifestUrl, StringComparison.Ordinal);
        if (repointed)
        {
            await RepointAsync(app, manifestUrl, ct);
        }

        app.IconKey = request.IconKey?.Trim();
        app.PermissionsSourceUrl = newSourceUrl;
        app.UpdatedAt = now;
        app.UpdatedBy = actingUserId;

        await db.SaveChangesAsync(ct);

        if (repointed)
        {
            await NavigationChangedAsync(ct);
        }

        if (app.Status != RemoteAppStatus.Disabled)
        {
            // Always re-fetch on save, not only when the URL changed — this is also how an admin picks
            // up a remote's newly-added capability without waiting for the periodic resync, by opening
            // and saving the edit form.
            await SyncCapabilitiesAsync(app.Feature.Key, displayName, request.SidebarOrder, newSourceUrl, ct);
        }

        await auditLog.WriteHostAsync(
            actingUserId, actorName, "remoteapp.updated",
            AuditLogAppService.Modules.Applications, AuditLogAppService.Categories.Crud,
            entityType: EntityType, entityId: id.ToString(), details:
            $"Updated remote app '{displayName}' ({app.Key}).", entityLabel: displayName, ct: ct);

        return MutationResult<RemoteAppDto>.Ok(await ReadDtoAsync(id, ct));
    }

    public async Task<MutationResult<RemoteAppDto>> UpdateStatusAsync(
        Guid id, string status, string? maintenanceMessage, Guid? actingUserId, string? actorName,
        CancellationToken ct = default, bool bypassApproval = false)
    {
        var app = await db.RemoteApps.Include(a => a.Feature).FirstOrDefaultAsync(a => a.FeatureId == id, ct)
            ?? throw NotFound(id);

        if (!Enum.TryParse<RemoteAppStatus>(status, out var parsedStatus))
        {
            throw new ValidationAppException($"Unknown status '{status}'. Expected Active, Maintenance, or Disabled.");
        }

        var proposed = Snapshot(app) with
        {
            Status = parsedStatus.ToString(),
            MaintenanceMessage = parsedStatus == RemoteAppStatus.Maintenance
                ? maintenanceMessage?.Trim()
                : app.MaintenanceMessage,
        };

        var pending = await TrySubmitForApprovalAsync(
            parsedStatus == RemoteAppStatus.Disabled ? ApprovalActionKeys.Disable : ApprovalActionKeys.Enable,
            id.ToString(), app.Feature!.DisplayName,
            JsonSerializer.Serialize(Snapshot(app)), proposed, actingUserId, bypassApproval, ct);

        if (pending is not null)
        {
            return MutationResult<RemoteAppDto>.PendingApproval(pending);
        }

        var wasDisabled = app.Status == RemoteAppStatus.Disabled;
        var becomingDisabled = parsedStatus == RemoteAppStatus.Disabled;

        app.Status = parsedStatus;
        app.MaintenanceMessage = parsedStatus == RemoteAppStatus.Maintenance
            ? maintenanceMessage?.Trim()
            : app.MaintenanceMessage;
        app.UpdatedAt = DateTimeOffset.UtcNow;
        app.UpdatedBy = actingUserId;

        await db.SaveChangesAsync(ct);

        // Disabling a remote app must pull its permission feature out of every role/override editor —
        // a Disabled app is not merely hidden from the sidebar, its capabilities stop being assignable
        // anywhere in the host. Re-activating restores assignability without the admin touching
        // anything else.
        if (becomingDisabled && !wasDisabled)
        {
            await catalog.DeactivateRemoteAppFeatureAsync(app.Feature.Key, ct);
        }
        else if (!becomingDisabled && wasDisabled)
        {
            // Null capabilities and null modules: re-enabling does not re-read the remote, so the
            // catalog should restore what it already holds rather than have it cleared by a sync that
            // simply had nothing to say.
            await catalog.UpsertRemoteAppFeatureAsync(
                app.Feature.Key, app.Feature.DisplayName, app.Feature.SortOrder, null, null, ct);
        }
        else
        {
            // A Maintenance toggle changes what the sidebar renders, and the sidebar is cached.
            await catalog.InvalidateNavigationAsync(ct);
        }

        // Open tabs re-read the tree, so a maintenance switch takes effect without anyone reloading.
        if (events is not null)
        {
            await events.PublishNavigationChangedAsync(ct);
        }

        await auditLog.WriteHostAsync(
            actingUserId, actorName, "remoteapp.status_changed",
            AuditLogAppService.Modules.Applications, AuditLogAppService.Categories.Crud,
            entityType: EntityType, entityId: id.ToString(), details:
            $"Set '{app.Feature.DisplayName}' ({app.Key}) status to {parsedStatus}.",
            entityLabel: app.Feature.DisplayName, ct: ct);

        return MutationResult<RemoteAppDto>.Ok(await ReadDtoAsync(id, ct));
    }

    /// <summary>Returns null once actually deleted; an <see cref="ApprovalPendingDto"/> if the delete was gated instead.</summary>
    public async Task<ApprovalPendingDto?> DeleteAsync(
        Guid id, Guid? actingUserId, string? actorName, CancellationToken ct = default, bool bypassApproval = false)
    {
        var app = await db.RemoteApps.Include(a => a.Feature).FirstOrDefaultAsync(a => a.FeatureId == id, ct)
            ?? throw NotFound(id);

        var displayName = app.Feature!.DisplayName;
        var key = app.Key;
        var featureKey = app.Feature.Key;
        var snapshot = Snapshot(app);

        // Both sides carry the stored snapshot, so a checker approving a deletion is shown the full
        // record being removed rather than an empty object.
        var pending = await TrySubmitForApprovalAsync(
            ApprovalActionKeys.Delete, id.ToString(), displayName,
            JsonSerializer.Serialize(snapshot), snapshot, actingUserId, bypassApproval, ct);

        if (pending is not null)
        {
            return pending;
        }

        db.RemoteApps.Remove(app);
        await db.SaveChangesAsync(ct);

        // The registration is gone; the permission feature is DEACTIVATED, not deleted. Deleting it
        // would orphan every RolePermission and UserPermissionOverride still naming it, and those rows
        // are the record of what an administrator actually granted.
        await catalog.DeactivateRemoteAppFeatureAsync(featureKey, ct);

        await auditLog.WriteHostAsync(
            actingUserId, actorName, "remoteapp.deleted",
            AuditLogAppService.Modules.Applications, AuditLogAppService.Categories.Crud,
            entityType: EntityType, entityId: id.ToString(), details:
            $"Removed remote app '{displayName}' ({key}).", entityLabel: displayName, ct: ct);

        return null;
    }

    /// <summary>
    /// Recovery utility — re-reads every registered app's capabilities from its PermissionsSourceUrl
    /// and re-syncs every non-Disabled app's permission feature.
    /// </summary>
    /// <param name="actingUserId">
    /// Who asked for the resync, for the audit record. Nullable because the parameter is optional to
    /// keep existing callers compiling; a resync with no attributable actor still gets a row, since
    /// the permission catalog changing anonymously is worse to discover than one that changed
    /// unattributably.
    /// </param>
    public async Task<int> ResyncPermissionsAsync(Guid? actingUserId = null, string? actorName = null, CancellationToken ct = default)
    {
        var apps = await db.RemoteApps.AsNoTracking().Include(a => a.Feature).ToListAsync(ct);

        var active = apps.Where(a => a.Status != RemoteAppStatus.Disabled).ToList();

        // Fetch every remote's capability list CONCURRENTLY. Sequentially, N registered apps cost N
        // round trips, and N unreachable ones each burned the client timeout in turn.
        var fetches = await Task.WhenAll(active.Select(async app => (
            app,
            discovered: string.IsNullOrWhiteSpace(app.PermissionsSourceUrl)
                ? null
                : await discovery.FetchAsync(app.PermissionsSourceUrl, ct))));

        // The catalog writes stay sequential on one context — DbContext is not thread-safe, so only
        // the network I/O above may overlap.
        var unreachable = new List<string>();
        foreach (var (app, discovered) in fetches)
        {
            if (!string.IsNullOrWhiteSpace(app.PermissionsSourceUrl) && discovered is null)
            {
                logger.LogWarning(
                    "Keeping last-known capability set for '{Key}' — permissions source unreachable or invalid.",
                    app.Key);
                unreachable.Add(app.Key);
            }

            // A null discovery flows straight through as "leave it alone". That is the whole guarantee:
            // an unreachable remote must never look like a remote that has withdrawn everything.
            var request = RemoteFeatureRequestBuilder.Build(
                app.Feature!.Key, app.Feature.DisplayName, app.Feature.SortOrder,
                discovered?.Capabilities, discovered?.Nav);

            await catalog.UpsertRemoteAppFeatureAsync(
                request.Key, request.DisplayName, request.SortOrder, request.Capabilities, request.Modules, ct);
        }

        /*
         * A resync rewrites the platform's entire permission catalog from what the remotes currently
         * declare, and it left no trace at all. Capabilities can appear, and — when a remote answers
         * with an empty list rather than being unreachable — disappear, deactivating every grant that
         * referenced them. An administrator finding that a role lost a permission overnight had
         * nothing to look at.
         *
         * The unreachable apps are named explicitly, because that is the case where the result is
         * "nothing changed for this app" rather than "this app declares nothing" — the null-vs-empty
         * distinction the whole discovery path is built around. A reviewer needs to know which of the
         * two a given resync actually produced.
         */
        await auditLog.WriteHostAsync(
            actingUserId, actorName, "remoteapp.permissions_resynced",
            AuditLogAppService.Modules.Applications, AuditLogAppService.Categories.Configuration,
            entityType: EntityType, entityId: null, entityLabel: "Remote app permissions",
            details: $"Resynced capabilities from {active.Count} active remote app(s) of {apps.Count} registered." +
                     (unreachable.Count > 0
                         ? $" Could not read {unreachable.Count} of them, whose stored capability sets were left unchanged: {string.Join(", ", unreachable)}."
                         : " All reachable."),
            result: unreachable.Count > 0 ? "Failure" : "Success",
            failureReason: unreachable.Count > 0
                ? $"{unreachable.Count} remote app(s) could not be read"
                : null,
            ct: ct);

        return apps.Count;
    }

    // ── Internals ────────────────────────────────────────────────────────────────

    /// <summary>
    /// Reads the remote's declared capabilities and hands them to the permission catalog. A null
    /// source URL, or a remote that could not be read, both arrive at the catalog as null — which
    /// means "keep what is stored".
    /// </summary>
    private async Task SyncCapabilitiesAsync(
        string featureKey, string displayName, int sortOrder, string? sourceUrl, CancellationToken ct)
    {
        RemoteDiscovery? discovered = null;

        if (!string.IsNullOrWhiteSpace(sourceUrl))
        {
            discovered = await discovery.FetchAsync(sourceUrl, ct);

            if (discovered is null)
            {
                logger.LogWarning(
                    "Keeping last-known capability set for '{FeatureKey}' — permissions source unreachable or invalid.",
                    featureKey);
            }
        }

        var request = RemoteFeatureRequestBuilder.Build(
            featureKey, displayName, sortOrder, discovered?.Capabilities, discovered?.Nav);

        await catalog.UpsertRemoteAppFeatureAsync(
            request.Key, request.DisplayName, request.SortOrder, request.Capabilities, request.Modules, ct);
    }

    /// <summary>
    /// Checks gating and, if gated, submits — the same "after validation, before mutation" insert
    /// UserAppService and RoleAppService use. Returns null when the caller should proceed to mutate
    /// directly (bypassing, no actor, or the module is not gated).
    /// </summary>
    private async Task<ApprovalPendingDto?> TrySubmitForApprovalAsync(
        string action, string? entityId, string entityLabel, string? oldDataJson,
        RemoteAppSnapshotDto proposed, Guid? actingUserId, bool bypassApproval,
        CancellationToken ct, string? entityKey = null)
    {
        if (bypassApproval || actingUserId is null)
        {
            return null;
        }

        if (!await gating.IsGatedAsync(ApprovalModuleKeys.Applications, ct))
        {
            return null;
        }

        // No callback URL: this module is replayed in-process by ApprovalAppService, not by POSTing
        // back to another service. Gating is a local database read now, so there is no "could not
        // reach the approval service" failure mode left to model either.
        return await gating.SubmitAsync(
            ApprovalModuleKeys.Applications, action, EntityType, entityId, entityLabel,
            oldDataJson, JsonSerializer.Serialize(proposed), actingUserId.Value, ct, entityKey: entityKey);
    }

    private async Task<RemoteAppDto> ReadDtoAsync(Guid featureId, CancellationToken ct)
    {
        var app = await db.RemoteApps.AsNoTracking().Include(a => a.Feature)
            .FirstOrDefaultAsync(a => a.FeatureId == featureId, ct) ?? throw NotFound(featureId);
        return ToDto(app);
    }

    private static RemoteAppSnapshotDto Snapshot(RemoteApp app) => new(
        app.Key, app.Feature!.DisplayName, app.IconKey, app.ManifestUrl, app.PermissionsSourceUrl,
        app.Feature.SortOrder, app.Status.ToString(), app.MaintenanceMessage);

    private static string? OptionalHttpUrl(string? value, string message)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var trimmed = value.Trim();
        return ManifestUrlPolicy.IsHttpUrl(trimmed) ? trimmed : throw new ValidationAppException(message);
    }

    /// <summary>
    /// Points an app at a different build: probes the manifest there and refuses unless it can be read
    /// and declares the same Module Federation container. Does not save.
    /// </summary>
    /// <remarks>
    /// Both the admin form (a changed manifest URL) and a release promotion come through here, so
    /// neither can put a dead URL or a different app in front of users. The container check is what
    /// stops a typo'd version folder that happens to hold another remote's build from mounting that
    /// remote under this app's name and permissions.
    /// </remarks>
    internal async Task<ManifestProbeResult> RepointAsync(RemoteApp app, string manifestUrl, CancellationToken ct)
    {
        var probe = await manifestClient.ProbeAsync(manifestUrl, ct);
        if (probe.Health != RemoteAppHealth.Healthy || probe.ContainerName is null)
        {
            throw new ValidationAppException(
                $"The build at {manifestUrl} could not be read, so users cannot be pointed at it: {probe.Error}");
        }

        if (app.ContainerName is not null && !string.Equals(app.ContainerName, probe.ContainerName, StringComparison.Ordinal))
        {
            throw new ConflictAppException(
                $"The build at {manifestUrl} is the Module Federation container '{probe.ContainerName}', but "
                + $"'{app.Key}' is '{app.ContainerName}'. That is a different app's build.");
        }

        var now = DateTimeOffset.UtcNow;
        app.ManifestUrl = manifestUrl;
        app.ContainerName = probe.ContainerName;
        app.Health = probe.Health;
        app.LastHealthCheckAt = now;
        app.LastHealthError = null;
        return probe;
    }

    /// <summary>Drops the cached navigation catalog and tells open tabs to re-read their tree.</summary>
    internal async Task NavigationChangedAsync(CancellationToken ct)
    {
        await catalog.InvalidateNavigationAsync(ct);
        if (events is not null)
        {
            await events.PublishNavigationChangedAsync(ct);
        }
    }

    /// <summary>
    /// True when the caller holds ANY permission on an app — on the app itself OR on one of its
    /// sub-modules.
    /// <para>
    /// The second clause is essential and easy to miss. Sub-module permissions are keyed
    /// "remote.lead.lead:Edit", which does NOT start with "remote.lead:" — so a prefix check on the
    /// colon form alone would hide the app entirely from a user whose only grants happen to be on its
    /// sub-modules. That is most users, once roles are scoped properly.
    /// </para>
    /// </summary>
    private static bool HasAnyPermissionFor(IReadOnlySet<string> permissions, string featureKey) =>
        permissions.Any(p =>
            p.StartsWith($"{featureKey}:", StringComparison.OrdinalIgnoreCase) ||
            p.StartsWith($"{featureKey}.", StringComparison.OrdinalIgnoreCase));

    private static string ToFeatureKey(string key) => $"remote.{key}";

    private static RemoteAppDto ToDto(RemoteApp a) => new(
        a.FeatureId, a.Key, a.Feature!.DisplayName, a.IconKey, a.ManifestUrl, a.Feature.SortOrder,
        a.Status.ToString(), a.MaintenanceMessage, a.Feature.Key, a.PermissionsSourceUrl,
        a.Health.ToString(), a.LastHealthCheckAt, a.LastHealthError, a.ContainerName,
        a.CreatedAt, a.UpdatedAt);

    private static NotFoundAppException NotFound(Guid id) => new($"Remote app '{id}' was not found.");
}
