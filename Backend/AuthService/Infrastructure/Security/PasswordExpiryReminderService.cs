using AuthService.Application.Services;
using AuthService.Infrastructure.Locking;
using AuthService.Options;
using Microsoft.Extensions.Options;

namespace AuthService.Infrastructure.Security;

/// <summary>
/// Runs <see cref="PasswordExpiryReminderSweeper"/> on an interval.
/// <para>
/// Same shape as <see cref="RefreshTokenCleanupService"/> — singleton resolving a scoped DbContext per
/// sweep, cancellation-guarded delays, a broad catch so one bad sweep never takes the service down.
/// </para>
/// <para>
/// One addition that cleanup does not need: the sweep takes a distributed lock first. Deleting expired
/// tokens twice is harmless; emailing every user twice is not, and with N replicas behind a load balancer
/// every one of them would otherwise run this. Whoever cannot take the lock simply skips the round.
/// </para>
/// </summary>
public class PasswordExpiryReminderService(
    IServiceProvider services,
    IDistributedLock locks,
    IOptions<PasswordExpiryReminderOptions> options,
    ILogger<PasswordExpiryReminderService> logger) : BackgroundService
{
    internal const string LockKey = "password-expiry-reminders";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var settings = options.Value;
        if (!settings.Enabled)
        {
            logger.LogInformation("Password-expiry reminders are disabled via configuration.");
            return;
        }

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
                await SweepAsync(settings, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Password-expiry reminder sweep failed; will retry on the next interval.");
            }

            try
            {
                await Task.Delay(settings.Interval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task SweepAsync(PasswordExpiryReminderOptions settings, CancellationToken ct)
    {
        // The TTL is only the backstop for a replica killed mid-sweep; it must comfortably outlast the work.
        await using var held = await locks.TryAcquireAsync(LockKey, TimeSpan.FromMinutes(30), ct);
        if (held is null)
        {
            return; // another replica is doing this round
        }

        using var scope = services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<PasswordExpiryReminderSweeper>().RunAsync(ct: ct);
    }
}
