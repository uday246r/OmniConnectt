using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace AuthService.Infrastructure.Seed;

/// <summary>
/// Restores what the schema migration could not, and reports what an operator still has to do by
/// hand after remote-app registration moved out of the Module Registry and into AuthDb.
/// </summary>
/// <remarks>
/// <para>
/// The migration reconstructs every registration from rows AuthDb already held, with one exception:
/// <see cref="RemoteApp.PermissionsSourceUrl"/> only ever lived in the registry's own database, which
/// a migration running against AuthDb cannot read. The two apps this platform ships with have theirs
/// restored here from the values the old registry seeded.
/// </para>
/// <para>
/// Everything below is idempotent and additive. A null source URL is filled; one an operator has
/// since pointed somewhere else is left exactly as it is. Nothing is ever overwritten.
/// </para>
/// </remarks>
public static class RemoteAppSeeder
{
    /// <summary>
    /// The permissions endpoints of the two built-in remotes, as the retired
    /// <c>ModuleRegistryDbSeeder</c> declared them. Keyed by app key.
    /// </summary>
    /// <remarks>
    /// Localhost URLs, because these are the defaults a developer gets on a fresh machine. A deployed
    /// environment supplies its own through <c>RemoteApps:BuiltIn:&lt;key&gt;</c> (inside docker compose
    /// they are service names, e.g. <c>http://lead:8080/api/lead-service/permissions</c>), and this seeder
    /// never touches a row that already has one.
    /// </remarks>
    private static readonly Dictionary<string, string> DefaultPermissionsSources = new(StringComparer.Ordinal)
    {
        ["customer360"] = "http://localhost:5059/permissions",
        ["lead"] = "http://localhost:5046/api/lead-service/permissions",
        ["products"] = "http://localhost:5266/permissions",
    };

    public static async Task SeedAsync(
        AuthDbContext db, ILogger logger, CancellationToken ct = default,
        IReadOnlyDictionary<string, string>? configuredSources = null)
    {
        var sources = new Dictionary<string, string>(DefaultPermissionsSources, StringComparer.Ordinal);
        foreach (var (key, url) in configuredSources ?? new Dictionary<string, string>())
        {
            if (!string.IsNullOrWhiteSpace(url)) sources[key.ToLowerInvariant()] = url.Trim();
        }

        await RestoreBuiltInPermissionsSourcesAsync(db, logger, sources, ct);
        await ReportAppsNeedingAttentionAsync(db, logger, ct);
        await ReportUnreplayableApprovalsAsync(db, logger, ct);
    }

    private static async Task RestoreBuiltInPermissionsSourcesAsync(
        AuthDbContext db, ILogger logger, IReadOnlyDictionary<string, string> sources, CancellationToken ct)
    {
        var keys = sources.Keys.ToList();

        var apps = await db.RemoteApps
            .Where(a => keys.Contains(a.Key) && a.PermissionsSourceUrl == null)
            .ToListAsync(ct);

        if (apps.Count == 0)
        {
            return;
        }

        foreach (var app in apps)
        {
            app.PermissionsSourceUrl = sources[app.Key];
            app.UpdatedAt = DateTimeOffset.UtcNow;

            logger.LogInformation(
                "Restored the permissions source URL for built-in remote app '{Key}': {Url}",
                app.Key, app.PermissionsSourceUrl);
        }

        await db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Names every app whose capability discovery is now inert, so the gap is visible in the startup
    /// log rather than discovered weeks later when a remote's new capability never appears.
    /// </summary>
    private static async Task ReportAppsNeedingAttentionAsync(
        AuthDbContext db, ILogger logger, CancellationToken ct)
    {
        var orphaned = await db.RemoteApps
            .AsNoTracking()
            .Where(a => a.PermissionsSourceUrl == null && a.Status != RemoteAppStatus.Disabled)
            .Select(a => a.Key)
            .ToListAsync(ct);

        if (orphaned.Count == 0)
        {
            return;
        }

        logger.LogWarning(
            "{Count} remote app(s) have no permissions source URL and will not pick up capability "
                + "changes from their remote: {Keys}. Their existing capabilities are intact and "
                + "nothing is revoked — set each app's Permissions URL under Setup > Applications to "
                + "resume discovery.",
            orphaned.Count, string.Join(", ", orphaned));
    }

    /// <summary>
    /// An approval raised against the old registry cannot be replayed here.
    /// </summary>
    /// <remarks>
    /// Its <c>EntityId</c> is a Guid from the registry's own <c>RemoteApp.Id</c> column, which has no
    /// counterpart in AuthDb — the new key is the permission feature's id. Approving one would fail to
    /// find the app and leave the request Pending forever, so they are named at startup and should be
    /// rejected and re-raised. The correct fix is to drain these before deploying; this exists because
    /// "should have been drained" and "was drained" are different things.
    /// </remarks>
    private static async Task ReportUnreplayableApprovalsAsync(
        AuthDbContext db, ILogger logger, CancellationToken ct)
    {
        const string applicationsModule = "host.settings.applications";

        var stranded = await db.ApprovalRequests
            .AsNoTracking()
            .Where(r => r.Module == applicationsModule
                && r.Status == "Pending"
                && r.SourceService != "AuthService")
            .Select(r => new { r.Id, r.Action, r.EntityLabel })
            .ToListAsync(ct);

        if (stranded.Count == 0)
        {
            return;
        }

        logger.LogError(
            "{Count} pending remote-app approval request(s) were raised by the retired ModuleRegistry "
                + "service and CANNOT be replayed — their entity ids refer to a database that no "
                + "longer exists. Reject them and ask the maker to raise them again: {Requests}",
            stranded.Count,
            string.Join("; ", stranded.Select(r => $"{r.Id} ({r.Action} '{r.EntityLabel}')")));
    }
}
