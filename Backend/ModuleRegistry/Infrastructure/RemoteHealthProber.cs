using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ModuleRegistry.Domain.Enums;
using ModuleRegistry.Options;

namespace ModuleRegistry.Infrastructure;

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
/// Counters live in memory rather than on the entity on purpose: a registry restart should re-probe
/// from a clean slate rather than resurrect a stale verdict, and it keeps this free of a migration.
/// </summary>
public class RemoteHealthProber(
    IServiceProvider services,
    IOptions<RemoteHealthOptions> options,
    ILogger<RemoteHealthProber> logger)
{
    private readonly RemoteHealthOptions _settings = options.Value;

    /// <summary>Consecutive failed probes per app since its last success.</summary>
    private readonly ConcurrentDictionary<Guid, int> _consecutiveFailures = new();

    /// <summary>Apps confirmed reachable at least once in this process lifetime.</summary>
    private readonly ConcurrentDictionary<Guid, bool> _everHealthy = new();

    /// <summary>One sweep at a time — concurrent refresh requests must not stampede the remotes.</summary>
    private readonly SemaphoreSlim _gate = new(1, 1);

    private DateTimeOffset _lastSweepAt = DateTimeOffset.MinValue;

    /// <summary>True while any app is not confirmed healthy, so the caller can poll more often.</summary>
    public bool HasUnsettledApps { get; private set; }

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

        // Non-blocking: if a sweep is already running, its result is about to land anyway.
        if (!await _gate.WaitAsync(TimeSpan.Zero, ct))
        {
            return false;
        }

        try
        {
            // Re-check inside the gate — another caller may have swept while we waited.
            if (DateTimeOffset.UtcNow - _lastSweepAt < maximumAge)
            {
                return false;
            }

            await ProbeCoreAsync(ct);
            return true;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Unconditional sweep, used by the background service on its own schedule.</summary>
    public async Task ProbeAllAsync(CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            await ProbeCoreAsync(ct);
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task ProbeCoreAsync(CancellationToken ct)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ModuleRegistryDbContext>();
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
                _consecutiveFailures.TryRemove(app.Id, out _);
                _everHealthy[app.Id] = true;

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
                var failures = _consecutiveFailures.AddOrUpdate(app.Id, 1, (_, n) => n + 1);

                // Always record WHY, even before the failure is confirmed — the reason stays visible
                // for diagnosis without the status itself crying wolf.
                app.LastHealthError = result.Error;

                // An app never yet seen healthy is most likely still building; one that was healthy
                // and is now failing is a genuine regression worth reporting quickly.
                var threshold = _everHealthy.ContainsKey(app.Id)
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
