using AuthService.Options;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace AuthService.Infrastructure.Security;

/// <summary>
/// Periodically deletes refresh tokens that are past their retention window.
/// <para>
/// Nothing removed these rows before: every login and every rotation inserted one, and the table grew
/// monotonically forever. Follows the same shape as the remote-app health probe — singleton service
/// resolving a scoped DbContext per sweep, cancellation-guarded delays, and a broad catch so one bad
/// sweep never takes the service down.
/// </para>
/// </summary>
public class RefreshTokenCleanupService(
    IServiceProvider services,
    IOptions<RefreshTokenCleanupOptions> options,
    ILogger<RefreshTokenCleanupService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var settings = options.Value;
        if (!settings.Enabled)
        {
            logger.LogInformation("Refresh-token cleanup is disabled via configuration.");
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
                logger.LogError(ex, "Refresh-token cleanup sweep failed; will retry on the next interval.");
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

    private async Task SweepAsync(RefreshTokenCleanupOptions settings, CancellationToken ct)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AuthDbContext>();

        var cutoff = DateTimeOffset.UtcNow - settings.Retention;

        // Deliberately keyed on ExpiresAt alone rather than "revoked OR expired".
        //
        // A revoked-but-not-yet-expired row is the predecessor of a token still in active use, and
        // its ReplacedByTokenId is the only link in that chain. Deleting it early would orphan the
        // pointer and destroy the trail that makes token-reuse detection auditable. Once a row is
        // past its own expiry AND the retention window, it can no longer be presented and the whole
        // chain segment is safe to drop together.
        // Two statements on purpose. ExecuteDeleteAsync cannot translate Take() — PostgreSQL has no
        // LIMIT on DELETE — so batching has to be expressed as "select the ids, then delete those
        // ids". Written as one ExecuteDelete with Take() it compiles cleanly and throws only at
        // runtime, where the sweep's own catch-all would bury it in an hourly log line.
        var doomedIds = await db.RefreshTokens
            .Where(t => t.ExpiresAt < cutoff)
            .OrderBy(t => t.ExpiresAt)
            .Take(settings.BatchSize)
            .Select(t => t.Id)
            .ToListAsync(ct);

        if (doomedIds.Count == 0)
        {
            return;
        }

        var deleted = await db.RefreshTokens
            .Where(t => doomedIds.Contains(t.Id))
            .ExecuteDeleteAsync(ct);

        if (deleted > 0)
        {
            logger.LogInformation("Refresh-token cleanup removed {Count} expired token(s) older than {Cutoff:u}.", deleted, cutoff);
        }
    }
}
