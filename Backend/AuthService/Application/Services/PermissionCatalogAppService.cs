using AuthService.Application.DTOs;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Seed;
using Microsoft.EntityFrameworkCore;
using AuthService.Infrastructure.Caching;

namespace AuthService.Application.Services;

/// <summary>
/// Read side (the Role editor's per-feature Features/Capabilities matrix, the profile screen's
/// readable permission list, permission gating) plus the write side that keeps RemoteApp-sourced
/// features — and their own dynamically-declared capabilities — in step with what each remote
/// declares.
/// </summary>
/// <remarks>
/// The write side used to be reached over HTTP, from a separate Module Registry service holding its
/// own copy of every capability set. It is now called directly by <see cref="RemoteAppAppService"/>,
/// which is what allows the null-versus-empty contract below to replace that copy.
/// </remarks>
public class PermissionCatalogAppService(AuthDbContext db, IPlatformCache cache, FineCapabilityService fineCapabilities)
{
    /// <summary>
    /// Drops the cached navigation catalog. For a change that alters what the sidebar RENDERS without
    /// touching the permission catalog at all — putting an app into Maintenance, for instance, where
    /// the feature and its capabilities are untouched but the row must now show a notice.
    /// </summary>
    public Task InvalidateNavigationAsync(CancellationToken ct = default) =>
        cache.RemoveAsync(NavigationAppService.CatalogCacheKey, ct);

    /// <summary>
    /// The catalog as one particular caller is allowed to see it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The unscoped overload lets any authenticated user enumerate every feature, sub-module and
    /// capability the platform contains — the exact inventory <see cref="Navigation.NavigationTreeBuilder"/>
    /// goes out of its way not to leak, where a row the caller may not use is omitted entirely rather
    /// than rendered as a disabled hint. One endpoint quietly undid the other.
    /// </para>
    /// <para>
    /// Gating the endpoint outright is the wrong fix: the profile screen reads the catalog for EVERY
    /// user, to turn "remote.lead:View" into something readable. So the response is scoped instead.
    /// A caller who can edit users or roles gets everything, because those editors exist to grant what
    /// the caller does not personally hold. Everyone else gets only the features they hold something
    /// on, which is all their own profile ever renders.
    /// </para>
    /// </remarks>
    /// <param name="heldPermissions">
    /// The caller's effective permissions — the JWT's <c>perms</c> claim UNION their fine-grained set.
    /// The union matters: a user whose only grant on an app is a dashboard widget holds nothing in the
    /// claim, and scoping on the claim alone would hide that app from their own profile.
    /// </param>
    public async Task<IReadOnlyList<PermissionFeatureDto>> GetCatalogForCallerAsync(
        bool activeOnly,
        IReadOnlySet<string> heldPermissions,
        bool isAdministrator,
        CancellationToken ct = default)
    {
        var full = await GetCatalogAsync(activeOnly, ct);

        var seesEverything = isAdministrator
            || Holds(heldPermissions, AuthDbSeeder.HostFeatureKeys.SettingsUsers, "View")
            || Holds(heldPermissions, AuthDbSeeder.HostFeatureKeys.SettingsRoles, "View");

        if (seesEverything)
        {
            return full;
        }

        // A parent survives if the caller holds anything on it OR on one of its children — the same
        // two-prefix rule the sidebar uses, and for the same reason: a sub-module permission
        // ("remote.lead.lead:View") does not start with "remote.lead:".
        return full
            .Select(f => f with
            {
                Children = f.Children.Where(c => HoldsAnythingOn(heldPermissions, c.Key)).ToList(),
            })
            .Where(f => HoldsAnythingOn(heldPermissions, f.Key) || f.Children.Count > 0)
            .ToList();
    }

    private static bool Holds(IReadOnlySet<string> permissions, string featureKey, string capability) =>
        permissions.Contains($"{featureKey}:{capability}");

    private static bool HoldsAnythingOn(IReadOnlySet<string> permissions, string featureKey) =>
        permissions.Any(p =>
            p.StartsWith($"{featureKey}:", StringComparison.OrdinalIgnoreCase) ||
            p.StartsWith($"{featureKey}.", StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// The whole catalog, unscoped. For internal callers (the checker-assignment module list, the
    /// remote-app resync) — never for an endpoint that answers a user directly.
    /// </summary>
    public async Task<IReadOnlyList<PermissionFeatureDto>> GetCatalogAsync(bool activeOnly, CancellationToken ct = default)
    {
        var query = db.PermissionFeatures.AsNoTracking().Include(f => f.Capabilities).AsQueryable();
        if (activeOnly)
        {
            query = query.Where(f => f.IsActive);
        }

        var features = await query
            .OrderBy(f => f.SortOrder)
            .ThenBy(f => f.DisplayName)
            .ToListAsync(ct);

        // Nest sub-modules under their parent rather than returning a flat list — the Role editor
        // renders a module as a table whose ROWS are its sub-modules, so a flat list would show
        // "Employee Management" and "Department" as unrelated siblings.
        var childrenByParent = features
            .Where(f => f.ParentFeatureId is not null)
            .GroupBy(f => f.ParentFeatureId!.Value)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<PermissionFeature>)g.ToList());

        return features
            .Where(f => f.ParentFeatureId is null)
            .Select(f => ToDto(f, childrenByParent.GetValueOrDefault(f.Id)))
            .ToList();
    }

    /// <summary>
    /// Upserts a RemoteApp feature, its sub-modules (as child features), and reconciles every
    /// capability set involved — declared capabilities upserted, undeclared ones deactivated. Idempotent.
    /// </summary>
    /// <param name="capabilities">
    /// <b>Null means the remote said nothing</b> and the stored set is left exactly as it is; an empty
    /// list is a real answer and deactivates them. See <see cref="UpsertPermissionFeatureRequest"/>.
    /// </param>
    /// <param name="modules">
    /// Same rule: null leaves every existing sub-module alone, including the stale-child sweep below.
    /// </param>
    public async Task UpsertRemoteAppFeatureAsync(
        string key,
        string displayName,
        int sortOrder,
        IReadOnlyList<UpsertCapabilityRequest>? capabilities,
        IReadOnlyList<UpsertModuleRequest>? modules = null,
        CancellationToken ct = default)
    {
        var now = DateTimeOffset.UtcNow;
        var parent = await UpsertFeatureRowAsync(key, displayName, sortOrder, capabilities, parentId: null, now, ct);

        // Null modules: the remote had nothing to say, so neither the child upserts nor the sweep
        // below should run. Treating null as an empty list here is what used to let one unreachable
        // remote deactivate every sub-module it owns — and every role grant on them with it.
        if (modules is not null)
        {
            var childKeys = modules.Select(m => $"{key}.{m.Key}").ToHashSet(StringComparer.Ordinal);

            foreach (var module in modules)
            {
                var child = await UpsertFeatureRowAsync(
                    $"{key}.{module.Key}", module.DisplayName, module.SortOrder, module.Capabilities, parent.Id, now, ct);

                await ReplaceNavItemsAsync(child.Id, module.Nav, ct);
            }

            // A sub-module the remote no longer declares is DEACTIVATED, never deleted — deleting it
            // would orphan every RolePermission still pointing at it, and those rows are the record of
            // what an administrator actually granted. Deactivated features drop out of the Role editor
            // and out of the JWT, which is the intended effect, while the history survives.
            var staleChildren = await db.PermissionFeatures
                .Where(f => f.ParentFeatureId == parent.Id && f.IsActive)
                .ToListAsync(ct);

            foreach (var stale in staleChildren.Where(c => !childKeys.Contains(c.Key)))
            {
                stale.IsActive = false;
                stale.UpdatedAt = now;
            }
        }

        await db.SaveChangesAsync(ct);

        // A resynced remote's new pages should appear in the sidebar on the next request, not after
        // the catalog cache happens to expire.
        await cache.RemoveAsync(NavigationAppService.CatalogCacheKey, ct);

        // A sync can deactivate a capability, which withdraws it from everyone at once. Leaving the
        // cached sets in place would keep serving a capability the catalog no longer has.
        await fineCapabilities.InvalidateAllAsync(ct);
    }

    /// <summary>
    /// Fully replaces a feature's sidebar rows — but only when the caller actually supplied some.
    /// <para>
    /// A null <paramref name="nav"/> means the remote had nothing to say: an older remote
    /// that predates navigation, or one that was unreachable when the sync ran. Clearing rows in that
    /// case would empty a working sidebar every time a remote hiccuped. An empty list is different —
    /// it is a positive statement that this module has no rows, and it clears them.
    /// </para>
    /// </summary>
    private async Task ReplaceNavItemsAsync(Guid featureId, IReadOnlyList<UpsertNavItemRequest>? nav, CancellationToken ct)
    {
        if (nav is null)
        {
            return;
        }

        var existing = await db.FeatureNavItems.Where(n => n.FeatureId == featureId).ToListAsync(ct);
        db.FeatureNavItems.RemoveRange(existing);

        // AddRange on the DbSet, not through a navigation collection: rows reached only by fixup get
        // their client-generated key treated as an existing row and issued as an UPDATE instead of an
        // INSERT. The same trap is documented on the capability sync.
        db.FeatureNavItems.AddRange(nav.Select(n => new FeatureNavItem
        {
            Id = Guid.NewGuid(),
            FeatureId = featureId,
            NavKey = n.Key,
            Label = n.Label,
            IconKey = n.IconKey,
            RouteSegment = n.RouteSegment,
            SortOrder = n.SortOrder,
            RequiredCapability = n.RequiredCapability,
        }));
    }

    /// <summary>Creates or updates one feature row and fully replaces its capabilities. Does not save.</summary>
    private async Task<PermissionFeature> UpsertFeatureRowAsync(
        string key,
        string displayName,
        int sortOrder,
        IReadOnlyList<UpsertCapabilityRequest>? capabilities,
        Guid? parentId,
        DateTimeOffset now,
        CancellationToken ct)
    {
        var existing = await db.PermissionFeatures.Include(f => f.Capabilities).FirstOrDefaultAsync(f => f.Key == key, ct);

        if (existing is null)
        {
            existing = new PermissionFeature
            {
                Id = Guid.NewGuid(),
                Key = key,
                DisplayName = displayName,
                Source = PermissionFeatureSource.RemoteApp,
                IsActive = true,
                SortOrder = sortOrder,
                ParentFeatureId = parentId,
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.PermissionFeatures.Add(existing);
        }
        else
        {
            existing.DisplayName = displayName;
            existing.SortOrder = sortOrder;
            existing.IsActive = true;
            existing.ParentFeatureId = parentId;
            existing.UpdatedAt = now;
        }

        // Null means the remote said nothing about its capabilities, so the stored set stands.
        if (capabilities is not null)
        {
            ReconcileCapabilities(existing, capabilities);
        }

        return existing;
    }

    /// <summary>
    /// Brings one feature's capability rows in line with what the remote just declared: declared ones
    /// are upserted and active, undeclared ones are deactivated.
    /// </summary>
    /// <remarks>
    /// This used to be <c>RemoveRange(existing.Capabilities)</c> followed by a blind re-add, which had
    /// two consequences. Every capability row was destroyed and recreated with a fresh Id on every
    /// single sync — so nothing could ever reference a capability by Id. And when a remote stopped
    /// declaring a capability, the row vanished while the RolePermission and UserPermissionOverride
    /// rows naming it did not, leaving grants for something that no longer existed; those grants then
    /// kept minting into tokens, because the claims builder had no capability row to check against.
    /// <para>
    /// Deactivating instead keeps the grant visible for audit and keeps the Id stable, while the
    /// claims builder's <c>IsActive</c> join is what actually stops the stale grant being minted.
    /// </para>
    /// </remarks>
    private void ReconcileCapabilities(PermissionFeature feature, IReadOnlyList<UpsertCapabilityRequest> declared)
    {
        // A snapshot, because the loop below adds rows and the navigation collection is fixed up by
        // the change tracker as it goes.
        var stored = feature.Capabilities.ToList();
        var byKey = stored.ToDictionary(c => c.Key, StringComparer.OrdinalIgnoreCase);
        var declaredKeys = declared.Select(d => d.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var incoming in declared)
        {
            var type = ParseType(incoming.Type);
            var groupKey = incoming.GroupKey ?? DeriveGroupKey(incoming.Key);

            if (byKey.TryGetValue(incoming.Key, out var row))
            {
                row.DisplayName = incoming.DisplayName;
                row.SortOrder = incoming.SortOrder;
                row.Description = incoming.Description;
                row.Type = type;
                row.GroupKey = groupKey;

                // A capability that comes back after being withdrawn becomes grantable again, and any
                // grant that survived the gap starts working again — which is the behaviour that makes
                // deactivate-instead-of-delete safe for a remote that is merely offline mid-deploy.
                row.IsActive = true;
                continue;
            }

            var added = new PermissionFeatureCapability
            {
                Id = Guid.NewGuid(),
                FeatureId = feature.Id,
                Key = incoming.Key,
                DisplayName = incoming.DisplayName,
                Description = incoming.Description,
                Type = type,
                GroupKey = groupKey,
                SortOrder = incoming.SortOrder,
                IsActive = true,
            };
            // Added through the DbSet, never through feature.Capabilities: a row reached only by
            // navigation fixup has its client-generated key mistaken for an existing row and is
            // issued as an UPDATE instead of an INSERT. The nav-item sync carries the same note.
            db.PermissionFeatureCapabilities.Add(added);

            // Only the local dictionary is updated — the change tracker will fix up the navigation
            // collection itself, and adding to it here as well would leave the same instance in it
            // twice, which the catalog read would then emit as a duplicate capability.
            byKey[incoming.Key] = added;
        }

        foreach (var row in stored.Where(c => c.IsActive && !declaredKeys.Contains(c.Key)))
        {
            row.IsActive = false;
        }
    }

    private static CapabilityType ParseType(string? value) =>
        Enum.TryParse<CapabilityType>(value, ignoreCase: true, out var parsed)
            ? parsed
            // An unrecognised type from a newer remote degrades to Api rather than failing the sync,
            // matching how the rest of the discovery ladder handles a shape it does not know. Api is
            // the safe direction: it is enforced by a filter, so it can only ever be stricter.
            : CapabilityType.Api;

    /// <summary>"kpi.total-leads" groups under "kpi"; "View" has no prefix and no group.</summary>
    private static string? DeriveGroupKey(string capabilityKey)
    {
        var dot = capabilityKey.IndexOf('.');
        return dot > 0 ? capabilityKey[..dot] : null;
    }

    public async Task DeactivateRemoteAppFeatureAsync(string key, CancellationToken ct = default)
    {
        var existing = await db.PermissionFeatures.FirstOrDefaultAsync(f => f.Key == key && f.Source == PermissionFeatureSource.RemoteApp, ct);
        if (existing is null)
        {
            return;
        }

        existing.IsActive = false;
        existing.UpdatedAt = DateTimeOffset.UtcNow;

        // A deactivated feature drops out of the sidebar and stops being grantable, but only once the
        // two caches that answer those questions are told. Without these the app stayed in the
        // navigation tree for up to the catalog TTL and its non-Api capabilities stayed live in the
        // fine-grained sets for another — so "Disable" appeared to do nothing for a minute.
        //
        // The delete path happened to be covered, because it followed up with a full resync. Plain
        // Disable had no such accident behind it.
        await db.SaveChangesAsync(ct);

        await cache.RemoveAsync(NavigationAppService.CatalogCacheKey, ct);
        await fineCapabilities.InvalidateAllAsync(ct);
    }

    /// <summary>Full recovery resync: upserts every feature+capability-set in <paramref name="features"/> as active, deactivates any RemoteApp feature not present in the list.</summary>
    public async Task ResyncRemoteAppFeaturesAsync(IReadOnlyList<UpsertPermissionFeatureRequest> features, CancellationToken ct = default)
    {
        var incomingKeys = features.Select(f => f.Key).ToHashSet();

        var existingRemoteFeatures = await db.PermissionFeatures
            .Include(f => f.Capabilities)
            .Where(f => f.Source == PermissionFeatureSource.RemoteApp)
            .ToListAsync(ct);

        foreach (var incoming in features)
        {
            // Named `ct:` — UpsertRemoteAppFeatureAsync gained a `modules` parameter before the
            // cancellation token, so a positional call would silently bind `ct` to `modules`.
            await UpsertRemoteAppFeatureAsync(
                incoming.Key, incoming.DisplayName, incoming.SortOrder, incoming.Capabilities, incoming.Modules, ct: ct);
        }

        var now = DateTimeOffset.UtcNow;

        // Only TOP-LEVEL features are swept here. Child features (sub-modules) carry keys like
        // "remote.employee.department", which never appear in incomingKeys — sweeping them by the
        // same rule would deactivate every sub-module of every app on each resync, silently stripping
        // those permissions from everyone. Children are reconciled by UpsertRemoteAppFeatureAsync,
        // which knows which sub-modules its own app actually declared.
        foreach (var existing in existingRemoteFeatures.Where(f =>
                     f.ParentFeatureId is null && !incomingKeys.Contains(f.Key) && f.IsActive))
        {
            existing.IsActive = false;
            existing.UpdatedAt = now;

            // A module going away takes its sub-modules with it.
            foreach (var child in existingRemoteFeatures.Where(c => c.ParentFeatureId == existing.Id && c.IsActive))
            {
                child.IsActive = false;
                child.UpdatedAt = now;
            }
        }

        await db.SaveChangesAsync(ct);
    }

    private static PermissionFeatureDto ToDto(PermissionFeature f, IReadOnlyList<PermissionFeature>? children = null) => new(
        f.Id, f.Key, f.DisplayName, f.Source.ToString(), f.SortOrder,
        f.Capabilities
            // Deactivated capabilities stay in the table for audit but must never be offered in the
            // editors — granting one would create exactly the stale grant this change exists to end.
            .Where(c => c.IsActive)
            .OrderBy(c => c.SortOrder).ThenBy(c => c.Key, StringComparer.Ordinal)
            .Select(c => new CapabilityDto(c.Key, c.DisplayName, c.Description, c.Type.ToString(), c.GroupKey))
            .ToList(),
        (children ?? [])
            .OrderBy(c => c.SortOrder).ThenBy(c => c.DisplayName)
            .Select(c => ToDto(c))
            .ToList());
}
