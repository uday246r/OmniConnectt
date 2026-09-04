using System.Threading.Channels;
using AuthService.Hubs;
using Microsoft.AspNetCore.SignalR;

namespace AuthService.Application.Events;

/// <summary>
/// Background service that coalesces dashboard refresh requests to prevent query storms.
/// Leading-edge fire with a hard 15-second floor between broadcasts.
/// </summary>
public class KpiCoalescerService(
    IHubContext<PlatformHub> hubContext,
    ILogger<KpiCoalescerService> logger) : BackgroundService
{
    private readonly Channel<bool> _channel = Channel.CreateBounded<bool>(new BoundedChannelOptions(1)
    {
        FullMode = BoundedChannelFullMode.DropOldest
    });

    private DateTimeOffset _lastFlush = DateTimeOffset.MinValue;
    private static readonly TimeSpan FloorDuration = TimeSpan.FromSeconds(15);

    public void RequestRefresh()
    {
        _channel.Writer.TryWrite(true);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await _channel.Reader.ReadAsync(stoppingToken);

                // Drain any additional pending tokens in the channel
                while (_channel.Reader.TryRead(out _)) { }

                var elapsed = DateTimeOffset.UtcNow - _lastFlush;
                if (elapsed < FloorDuration)
                {
                    await Task.Delay(FloorDuration - elapsed, stoppingToken);
                    // Drain any tokens that arrived during the wait
                    while (_channel.Reader.TryRead(out _)) { }
                }

                _lastFlush = DateTimeOffset.UtcNow;
                await hubContext.Clients.All.SendAsync("platformEvent", new PlatformEvent("kpis"), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "KPI coalescer encountered an unexpected error.");
            }
        }
    }
}
