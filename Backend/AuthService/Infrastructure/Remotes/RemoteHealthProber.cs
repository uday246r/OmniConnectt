using System.Collections.Concurrent;
using AuthService.Domain.Enums;
using AuthService.Infrastructure.Locking;
using AuthService.Options;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace AuthService.Infrastructure.Remotes;

/// <summary>
/// Probes every registered remote app and decides what its health actually is.
///
/// A singleton, shared by the background sweep and the on-demand refresh endpoint, because the
/// consecutive-failure counters below have to be common to both: two components each keeping their
/// own tally would disagree about whether an app has failed often enough to be called down.
///
/// <para><b>Why "confirm before degrading" exists.</b> This previously wrote the probe verdict
/// straight through — one failed probe marked an app Unreachable, and because the controller serves
/// that stored value without re-probing, the result was cached for up to a full sweep interval. The
/// remotes are served by `vite build --watch` + `vite preview`, so they are legitimately unreachable
/// for a few seconds after `pnpm dev` while the first build runs. A sweep landing in that window
/// declared the app down, and the dashboard kept saying "Degraded" long after it had come up —
/// measured at 23.7s of false alarm in one run, with the app serving again within 1s.</para>
///
/// <para><b>Startup is treated differently from regression, deliberately.</b> An app that has never
/// been seen healthy is probably still starting, so it gets a long grace period and stays
/// <see cref="RemoteAppHealth.Unknown"/> — which the dashboard already renders as a neutral
/// "Checking" rather than an error. An app that WAS healthy and starts failing is a real regression
/// and is confirmed after only a couple of failures. Patience where it is warranted, speed where it
/// matters.</para>
///
/// <para><b>Exactly one replica sweeps at a time.</b> The gate is an <see cref="IDistributedLock"/>,
/// not a private semaphore, so scaling this service out does not multiply the probe traffic hitting
/// every remote. Whichever replica holds the lock does the work and writes it to the shared database;
/// the others read the result like any other caller.</para>
///
/// <para>
/// The consequence to be deliberate about: the failure counters below are per PROCESS, so on a
/// leadership change the new sweeper starts counting from zero. That is the safe direction — a fresh
/// counter falls back to <see cref="RemoteHealthOptions.StartupGraceFailures"/> rather than
/// <see cref="RemoteHealthOptions.ConfirmedFailures"/>, so a healthy app reads "Checking" for a little
/// longer instead of being falsely declared down. Persisting them would buy accuracy in a case that
/// resolves itself within one sweep, at the cost of a table and a write per probe.
/// </para>
/// </summary>
public class RemoteHealthProber(
    IServiceProvider services,
    IDistributedLock locks,
    IOptions<RemoteHealthOptions> options,
    ILogger<RemoteHealthProber> logger)
{
    private readonly RemoteHealthOptions _settings = options.Value;

    /// <summary>Shared across every replica: the name of the one sweep that may be in flight.</summary>
    private const string SweepLockKey = "remote-health:sweep";

    /// <summary>Consecutive failed probes per app since its last success.</summary>
    private readonly ConcurrentDictionary<Guid, int> _consecutiveFailures = new();

    /// <summary>Apps confirmed reachable at least once in this process lifetime.</summary>
    private readonly ConcurrentDictionary<Guid, bool> _everHealthy = new();

    private DateTimeOffset _lastSweepAt = DateTimeOffset.MinValue;

    /// <summary>True while any app is not confirmed healthy, so the caller can poll more often.</summary>
    public bool HasUnsettledApps { get; private set; }

    /// <summary>
    /// Long enough that a slow sweep never loses the lock mid-probe, short enough that a replica
    /// killed while holding it does not block the next sweep for long.
    /// </summary>
    private TimeSpan LockTtl => _settings.Interval + TimeSpan.FromSeconds(30);

    /// <summary>
    /// Probes only if the last sweep is older than <paramref name="maximumAge"/>; otherwise does
    /// nothing and reports false. This is what keeps a user holding down refresh from turning into a
    /// probe storm against the remotes.
    /// </summary>
    public async Task<bool> ProbeIfStaleAsync(TimeSpan maximumAge, CancellationToken ct = default)
    {
        if (DateTimeOffset.UtcNow - _lastSweepAt < maximumAge)
        {
            return false;
        }

        // Non-blocking: if a sweep is already running — here or on another replica — its result is
        // about to land in the shared database anyway.
        await using var lease = await locks.TryAcquireAsync(SweepLockKey, LockTtl, ct);
        if (lease is null)
        {
            await RefreshUnsettledFromStoreAsync(ct);
            return false;
        }

        // Re-check inside the lock — another caller may have swept while we waited.
        if (DateTimeOffset.UtcNow - _lastSweepAt < maximumAge)
        {
            return false;
        }

        await ProbeCoreAsync(ct);
        return true;
    }

    /// <summary>Sweep on the background service's own schedule, if no other replica is already doing it.</summary>
    public async Task ProbeAllAsync(CancellationToken ct = default)
    {
        await using var lease = await locks.TryAcquireAsync(SweepLockKey, LockTtl, ct);
        if (lease is null)
        {
            await RefreshUnsettledFromStoreAsync(ct);
            return;
        }

        await ProbeCoreAsync(ct);
    }

    /// <summary>
    /// Recomputes the polling hint from the shared table rather than from this process's own last
    /// sweep.
    /// </summary>
    /// <remarks>
    /// Without this a replica that never wins the lock would see no unhealthy app of its own, settle
    /// on the slow interval forever, and stop competing for the sweep at the rate the fast interval
    /// intends. The state that matters is in the database, and every replica can read it.
    /// </remarks>
    private async Task RefreshUnsettledFromStoreAsync(CancellationToken ct)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AuthDbContext>();

        HasUnsettledApps = await db.RemoteApps
            .AsNoTracking()
            .AnyAsync(a => a.Status != RemoteAppStatus.Disabled && a.Health != RemoteAppHealth.Healthy, ct);
    }

    private async Task ProbeCoreAsync(CancellationToken ct)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AuthDbContext>();
        var manifestClient = scope.ServiceProvider.GetRequiredService<RemoteManifestClient>();

        var apps = await db.RemoteApps
            .Where(a => a.Status != RemoteAppStatus.Disabled)
            .ToListAsync(ct);

        _lastSweepAt = DateTimeOffset.UtcNow;

        if (apps.Count == 0)
        {
            HasUnsettledApps = false;
            return;
        }

        // Concurrently, not sequentially: N unreachable remotes would otherwise cost N × timeout.
        var probes = apps.Select(async app => (app, result: await manifestClient.ProbeAsync(app.ManifestUrl, ct)));
        var results = await Task.WhenAll(probes);
        var now = DateTimeOffset.UtcNow;

        var unsettled = false;

        foreach (var (app, result) in results)
        {
            var previous = app.Health;

            if (result.Health == RemoteAppHealth.Healthy)
            {
                _consecutiveFailures.TryRemove(app.FeatureId, out _);
                _everHealthy[app.FeatureId] = true;

                app.Health = RemoteAppHealth.Healthy;
                app.LastHealthError = null;

                // Only overwrite the recorded container name on a successful probe — a transient
                // outage must not erase what we already know about the app.
                if (result.ContainerName is not null)
                {
                    app.ContainerName = result.ContainerName;
                }
            }
            else
            {
                var failures = _consecutiveFailures.AddOrUpdate(app.FeatureId, 1, (_, n) => n + 1);

                // Always record WHY, even before the failure is confirmed — the reason stays visible
                // for diagnosis without the status itself crying wolf.
                app.LastHealthError = result.Error;

                // An app never yet seen healthy is most likely still building; one that was healthy
                // and is now failing is a genuine regression worth reporting quickly.
                var threshold = _everHealthy.ContainsKey(app.FeatureId)
                    ? _settings.ConfirmedFailures
                    : _settings.StartupGraceFailures;

                if (failures >= threshold)
                {
                    app.Health = RemoteAppHealth.Unreachable;
                }
                else
                {
                    logger.LogDebug(
                        "Remote app '{Key}' probe failed ({Failures}/{Threshold}) — not reporting it down yet. {Error}",
                        app.Key, failures, threshold, result.Error);
                }

                unsettled = true;
            }

            app.LastHealthCheckAt = now;

            if (app.Health != previous)
            {
                logger.LogInformation(
                    "Remote app '{Key}' health changed {Previous} -> {Current}{Error}",
                    app.Key, previous, app.Health,
                    app.LastHealthError is null ? string.Empty : $" ({app.LastHealthError})");
            }

            if (app.Health != RemoteAppHealth.Healthy)
            {
                unsettled = true;
            }
        }

        HasUnsettledApps = unsettled;
        await db.SaveChangesAsync(ct);
    }
}
