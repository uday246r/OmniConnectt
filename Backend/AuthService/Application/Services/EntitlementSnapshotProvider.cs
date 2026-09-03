using AuthService.Application.Entitlements;
using AuthService.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace AuthService.Application.Services;

/// <summary>
/// Holds the whole entitlement map in memory so the authorization filters can check licensing without
/// a database round trip on every request.
/// <para>
/// The alternative designs were both worse. Putting entitlement into the JWT would be free to read
/// but impossible to revoke: tokens rotate on the client's schedule, so a lapsed licence would stay
/// usable per-user for an unpredictable window — unacceptable for a commercial control. Checking the
/// database per request would be exact but adds a query to the hot path of every endpoint in the
/// system, and the entire authorization design here is deliberately zero-DB-touch.
/// </para>
/// <para>
/// A cached snapshot is the middle: staleness is bounded, platform-wide and predictable rather than
/// per-user and unbounded, and the map is a few dozen rows so holding all of it is trivial. Writes
/// through <see cref="EntitlementAppService"/> invalidate it immediately, so the only window that
/// exists at all is between other nodes' refreshes.
/// </para>
/// </summary>
public class EntitlementSnapshotProvider(IServiceScopeFactory scopeFactory, ILogger<EntitlementSnapshotProvider> logger)
{
    private static readonly TimeSpan RefreshInterval = TimeSpan.FromSeconds(30);

    private readonly SemaphoreSlim _gate = new(1, 1);
    private IReadOnlyDictionary<string, EntitlementEntry> _map = new Dictionary<string, EntitlementEntry>();
    private DateTimeOffset _loadedAt = DateTimeOffset.MinValue;

    /// <summary>Forces the next read to reload. Called after any entitlement write.</summary>
    public void Invalidate() => _loadedAt = DateTimeOffset.MinValue;

    /// <summary>
    /// The current map, refreshed if stale.
    /// <para>On a load failure the previous map is kept rather than discarded. An empty map means
    /// "everything licensed" (the resolver fails open), so throwing away a good snapshot because one
    /// query timed out would silently unlock the entire product — the exact opposite of what a
    /// licensing failure should do.</para>
    /// </summary>
    public async Task<IReadOnlyDictionary<string, EntitlementEntry>> GetAsync(CancellationToken ct = default)
    {
        if (DateTimeOffset.UtcNow - _loadedAt < RefreshInterval) return _map;

        await _gate.WaitAsync(ct);
        try
        {
            // Re-check inside the gate: several requests can queue on a cold start, and only the
            // first should pay for the query.
            if (DateTimeOffset.UtcNow - _loadedAt < RefreshInterval) return _map;

            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AuthDbContext>();

            var features = await db.PermissionFeatures.AsNoTracking().ToListAsync(ct);
            var rows = await db.ModuleEntitlements.AsNoTracking().Where(e => e.CompanyId == null).ToListAsync(ct);

            _map = EntitlementAppService.BuildMap(features, rows);
            _loadedAt = DateTimeOffset.UtcNow;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Could not refresh the entitlement snapshot; keeping the previous one.");
            // Deliberately do NOT bump _loadedAt — the next request retries rather than serving a
            // stale map for a full interval after a failure.
        }
        finally
        {
            _gate.Release();
        }

        return _map;
    }
}
