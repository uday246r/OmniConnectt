using AuthService.Application.DTOs;
using AuthService.Application.Exceptions;
using AuthService.Application.Remotes;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Remotes;
using Microsoft.EntityFrameworkCore;

namespace AuthService.Application.Services;

/// <summary>
/// Stages, promotes and rolls back published builds of the host shell and the remote apps.
/// </summary>
/// <remarks>
/// <para>
/// A release never replaces files users are loading. Each build is published to its own immutable
/// folder first (<c>/modules/lead/4.7.3/</c>), which by itself changes nothing anyone sees. Promoting it
/// is one row: the app's <see cref="RemoteApp.ManifestUrl"/> moves to the new folder, navigation is
/// invalidated, and open tabs are told to re-read their tree. The host is not rebuilt, no container
/// restarts, no other remote is touched — and a tab that already has the old version open keeps
/// loading the old version's chunks, because they are still there. Rolling back is the same move in
/// the other direction.
/// </para>
/// <para>
/// Two checks stand between a build and users. The manifest must be readable and declare this app's
/// own container (<see cref="RemoteAppAppService.RepointAsync"/>), so a wrong folder cannot mount
/// another app's code under this app's name. And the remote's <c>requiredHostBridge</c> range must be
/// satisfied by the live host's bridge version — checked again by the browser before mounting, with
/// the same rules (<see cref="SemVerRange"/>), so an incompatible pair fails as a refused promotion
/// instead of as "undefined is not a function" in front of a user. Promoting a host is checked against
/// every live remote the same way.
/// </para>
/// <para>
/// Who may promote is decided outside this class: the endpoint accepts only the ReleaseAgent's own
/// internal key, and the pipeline holding that key requires a human approval on its production
/// environment. Administrators can still re-point an app through Setup → Applications, which keeps its
/// maker-checker gating and goes through the same <see cref="RemoteAppAppService.RepointAsync"/> checks.
/// </para>
/// </remarks>
public class ReleaseAppService(
    AuthDbContext db,
    RemoteAppAppService remoteApps,
    RemoteManifestClient manifestClient,
    AuditLogAppService auditLog,
    ILogger<ReleaseAppService> logger)
{
    public async Task<IReadOnlyList<ReleaseRecordDto>> ListAsync(string? key, CancellationToken ct = default)
    {
        var query = db.ReleaseRecords.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(key))
        {
            var k = key.Trim().ToLowerInvariant();
            query = query.Where(r => r.Key == k);
        }

        var rows = await query.OrderBy(r => r.Key).ThenByDescending(r => r.RegisteredAt).ToListAsync(ct);
        return rows.Select(ToDto).ToList();
    }

    /// <summary>
    /// Records a published build as available. Idempotent for the same content; a second registration
    /// of the same version with a different checksum is refused — a version names one build, forever.
    /// </summary>
    /// <remarks>
    /// The one exception to "registering changes nothing users see" is an app that does not exist yet:
    /// on a fresh installation there is no previous version to protect, so its first build is registered
    /// as an app and made live in the same call.
    /// </remarks>
    public async Task<ReleaseRecordDto> RegisterAsync(RegisterReleaseRequest request, CancellationToken ct = default)
    {
        var key = request.Key.Trim().ToLowerInvariant();
        var version = request.Version.Trim();

        var existing = await db.ReleaseRecords.FirstOrDefaultAsync(r => r.Key == key && r.Version == version, ct);
        if (existing is not null)
        {
            if (!string.IsNullOrEmpty(existing.Checksum) && !string.IsNullOrEmpty(request.Checksum)
                && !string.Equals(existing.Checksum, request.Checksum, StringComparison.OrdinalIgnoreCase))
            {
                throw new ConflictAppException(
                    $"{key} {version} is already registered with different content. Publish the change as a new version.");
            }
            return ToDto(existing);
        }

        var record = new ReleaseRecord
        {
            Id = Guid.NewGuid(),
            Key = key,
            Version = version,
            Checksum = request.Checksum?.Trim(),
            ReleaseId = request.ReleaseId?.Trim(),
            RegisteredAt = DateTimeOffset.UtcNow,
            Status = ReleaseStatus.Staged,
        };

        if (key == ReleaseRecord.HostKey)
        {
            record.BridgeVersion = string.IsNullOrWhiteSpace(request.BridgeVersion)
                ? throw new ValidationAppException("A host build must say which bridge version it provides (bridgeVersion).")
                : request.BridgeVersion.Trim();
        }
        else
        {
            var manifestUrl = ManifestUrlPolicy.Normalize(ManifestUrlPolicy.ForVersion(key, version), key, allowAbsolute: false);
            var probe = await manifestClient.ProbeAsync(manifestUrl, ct);
            if (probe.Health != RemoteAppHealth.Healthy || probe.ContainerName is null)
            {
                throw new ValidationAppException(
                    $"{key} {version} was not found on the web server at {manifestUrl}: {probe.Error} "
                    + "Publish its folder before registering it.");
            }

            record.ManifestUrl = manifestUrl;
            record.ContainerName = probe.ContainerName;
            record.RequiredHostBridge = probe.Metadata?.RequiredHostBridge;
        }

        db.ReleaseRecords.Add(record);
        await db.SaveChangesAsync(ct);

        if (key != ReleaseRecord.HostKey && !await db.RemoteApps.AnyAsync(a => a.Key == key, ct))
        {
            await RegisterFirstBuildAsync(record, request, ct);
        }

        return ToDto(record);
    }

    /// <summary>Makes a registered build the one users load.</summary>
    public async Task<ReleaseRecordDto> PromoteAsync(string key, string version, string actor, CancellationToken ct = default)
    {
        key = key.Trim().ToLowerInvariant();
        version = version.Trim();

        var record = await db.ReleaseRecords.FirstOrDefaultAsync(r => r.Key == key && r.Version == version, ct)
            ?? throw new NotFoundAppException($"{key} {version} has not been registered. Register it before promoting it.");

        if (record.Status == ReleaseStatus.Live)
        {
            return ToDto(record);
        }

        var current = await db.ReleaseRecords.FirstOrDefaultAsync(r => r.Key == key && r.Status == ReleaseStatus.Live, ct);

        if (key == ReleaseRecord.HostKey)
        {
            await EnsureLiveRemotesAcceptAsync(record.BridgeVersion!, ct);
        }
        else
        {
            await EnsureLiveHostAcceptsAsync(record, ct);

            var app = await db.RemoteApps.Include(a => a.Feature).FirstOrDefaultAsync(a => a.Key == key, ct)
                ?? throw new NotFoundAppException($"No remote app '{key}' is registered.");
            await remoteApps.RepointAsync(app, record.ManifestUrl!, ct);
            app.UpdatedAt = DateTimeOffset.UtcNow;
        }

        await SwapLiveAsync(current, record, actor, ct);

        if (key != ReleaseRecord.HostKey)
        {
            await remoteApps.NavigationChangedAsync(ct);
        }

        await auditLog.WriteHostAsync(
            actorUserId: null, actorName: actor, action: "release.promoted",
            module: AuditLogAppService.Modules.Applications, actionCategory: AuditLogAppService.Categories.Configuration,
            entityType: "Release", entityId: record.Id.ToString(), entityLabel: $"{key} {version}",
            details: current is null
                ? $"Made {key} {version} live."
                : $"Made {key} {version} live, replacing {current.Version}.",
            ct: ct);

        logger.LogInformation("Promoted {Key} {Version} (was {Previous}) by {Actor}.", key, version, current?.Version ?? "none", actor);
        return ToDto(record);
    }

    /// <summary>Puts back the build that was live before the current one.</summary>
    public async Task<ReleaseRecordDto> RollbackAsync(string key, string actor, CancellationToken ct = default)
    {
        key = key.Trim().ToLowerInvariant();

        var previous = await db.ReleaseRecords.AsNoTracking()
            .Where(r => r.Key == key && r.Status == ReleaseStatus.Superseded && r.PromotedAt != null)
            .OrderByDescending(r => r.PromotedAt)
            .FirstOrDefaultAsync(ct)
            ?? throw new NotFoundAppException($"{key} has no earlier live version to roll back to.");

        return await PromoteAsync(key, previous.Version, actor, ct);
    }

    // ── Internals ────────────────────────────────────────────────────────────────

    private async Task EnsureLiveHostAcceptsAsync(ReleaseRecord remote, CancellationToken ct)
    {
        var host = await db.ReleaseRecords.AsNoTracking()
            .FirstOrDefaultAsync(r => r.Key == ReleaseRecord.HostKey && r.Status == ReleaseStatus.Live, ct);

        // No host release recorded (a development database, or the very first deploy, where the host is
        // promoted after its remotes are registered): nothing to check against yet. The browser still
        // checks before mounting.
        if (host?.BridgeVersion is null || string.IsNullOrWhiteSpace(remote.RequiredHostBridge))
        {
            return;
        }

        if (!SemVerRange.Satisfies(host.BridgeVersion, remote.RequiredHostBridge))
        {
            throw new ConflictAppException(
                $"{remote.Key} {remote.Version} needs host bridge {remote.RequiredHostBridge}, but the live host "
                + $"{host.Version} provides {host.BridgeVersion}. Release a compatible host first.");
        }
    }

    private async Task EnsureLiveRemotesAcceptAsync(string bridgeVersion, CancellationToken ct)
    {
        var remotes = await db.ReleaseRecords.AsNoTracking()
            .Where(r => r.Key != ReleaseRecord.HostKey && r.Status == ReleaseStatus.Live && r.RequiredHostBridge != null)
            .ToListAsync(ct);

        var refusing = remotes.Where(r => !SemVerRange.Satisfies(bridgeVersion, r.RequiredHostBridge!)).ToList();
        if (refusing.Count > 0)
        {
            throw new ConflictAppException(
                $"This host provides bridge {bridgeVersion}, which the live "
                + string.Join(", ", refusing.Select(r => $"{r.Key} {r.Version} (needs {r.RequiredHostBridge})"))
                + " cannot use. Promote compatible remotes first.");
        }
    }

    /// <summary>
    /// Old live → superseded, then new → live, as two statements: the database allows one live row per
    /// key, and a single batch could apply the second update first.
    /// </summary>
    private async Task SwapLiveAsync(ReleaseRecord? current, ReleaseRecord next, string actor, CancellationToken ct)
    {
        var relational = db.Database.IsRelational();
        await using var tx = relational ? await db.Database.BeginTransactionAsync(ct) : null;

        if (current is not null)
        {
            current.Status = ReleaseStatus.Superseded;
            await db.SaveChangesAsync(ct);
        }

        next.Status = ReleaseStatus.Live;
        next.PromotedAt = DateTimeOffset.UtcNow;
        next.PromotedBy = actor;
        await db.SaveChangesAsync(ct);

        if (tx is not null)
        {
            await tx.CommitAsync(ct);
        }
    }

    private async Task RegisterFirstBuildAsync(ReleaseRecord record, RegisterReleaseRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.DisplayName))
        {
            logger.LogWarning(
                "{Key} {Version} is registered, but '{Key}' is not an application yet and no display name was given; "
                + "register it in Setup → Applications or re-register with a displayName.", record.Key, record.Version, record.Key);
            return;
        }

        await remoteApps.CreateAsync(
            new CreateRemoteAppRequest(
                record.Key, request.DisplayName.Trim(), request.IconKey, record.ManifestUrl!,
                request.PermissionsSourceUrl, request.SidebarOrder ?? 100),
            actingUserId: null, actorName: "release-agent", ct, bypassApproval: true);

        record.Status = ReleaseStatus.Live;
        record.PromotedAt = DateTimeOffset.UtcNow;
        record.PromotedBy = "release-agent (first install)";
        await db.SaveChangesAsync(ct);
    }

    private static ReleaseRecordDto ToDto(ReleaseRecord r) => new(
        r.Key, r.Version, r.Status.ToString(), r.ManifestUrl, r.ContainerName, r.RequiredHostBridge,
        r.BridgeVersion, r.Checksum, r.ReleaseId, r.RegisteredAt, r.PromotedAt, r.PromotedBy);
}
