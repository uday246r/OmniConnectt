using Microsoft.Extensions.Options;
using AuthService.Options;

namespace AuthService.Infrastructure.Remotes;

/// <summary>
/// Schedules the reachability sweep. All the probing and health decisions live in
/// <see cref="RemoteHealthProber"/>, which the on-demand refresh endpoint shares — this class only
/// decides <em>when</em> to run one.
///
/// The interval is adaptive, and that is the point. The host reads the STORED health on every page
/// load without re-probing, so the sweep cadence is exactly how long a wrong answer stays on screen.
/// A fixed 60s meant an app that had come back up was still reported down for up to a minute, and
/// refreshing the page could not fix it because refreshing does not probe. Backing off to 60s only
/// once everything is settled keeps the steady-state cost unchanged while making recovery quick.
/// </summary>
public class RemoteAppHealthProbeService(
    RemoteHealthProber prober,
    IOptions<RemoteHealthOptions> options,
    ILogger<RemoteAppHealthProbeService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var settings = options.Value;
        if (!settings.Enabled)
        {
            logger.LogInformation("Remote app health probing is disabled via configuration.");
            return;
        }

        // Brief, not the old ten seconds: an early probe is now harmless because a first failure only
        // starts the failure count rather than declaring the app down.
        try
        {
            await Task.Delay(settings.StartupDelay, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await prober.ProbeAllAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                // A failed sweep must never kill the background service — the next one may succeed.
                logger.LogError(ex, "Remote app health sweep failed; will retry on the next interval.");
            }

            var delay = prober.HasUnsettledApps ? settings.UnhealthyInterval : settings.Interval;

            try
            {
                await Task.Delay(delay, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }
}
