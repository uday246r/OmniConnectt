using AuthService.Hubs;
using Microsoft.AspNetCore.SignalR;

namespace AuthService.Application.Events;

/// <summary>
/// Singleton SignalR publisher over <see cref="IHubContext{PlatformHub}"/>.
/// All dispatch calls are defensively wrapped with try/catch to ensure SignalR failures
/// never abort committed database operations.
/// </summary>
public class SignalRPlatformEventPublisher(
    IHubContext<PlatformHub> hubContext,
    KpiCoalescerService kpiCoalescer,
    ILogger<SignalRPlatformEventPublisher> logger) : IPlatformEventPublisher
{
    public async Task PublishToApprovalViewersAsync(PlatformEvent @event, CancellationToken ct = default)
    {
        try
        {
            await hubContext.Clients.Group(PlatformHub.GroupNames.ApprovalViewers).SendAsync("platformEvent", @event, ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to publish platformEvent to approvals.viewers (Topic={Topic}, Action={Action})", @event.Topic, @event.Action);
        }
    }

    public async Task PublishToAuditViewersAsync(PlatformEvent @event, CancellationToken ct = default)
    {
        try
        {
            await hubContext.Clients.Group(PlatformHub.GroupNames.AuditViewers).SendAsync("platformEvent", @event, ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to publish platformEvent to audit.viewers (Topic={Topic}, Action={Action})", @event.Topic, @event.Action);
        }
    }

    public async Task PublishToCheckerAssignmentViewersAsync(PlatformEvent @event, CancellationToken ct = default)
    {
        try
        {
            await hubContext.Clients.Group(PlatformHub.GroupNames.CheckerAssignmentViewers).SendAsync("platformEvent", @event, ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to publish platformEvent to {Group} (Topic={Topic}, Action={Action})", PlatformHub.GroupNames.CheckerAssignmentViewers, @event.Topic, @event.Action);
        }
    }

    public async Task PublishToUsersAsync(IEnumerable<Guid> userIds, PlatformEvent @event, CancellationToken ct = default)
    {
        foreach (var userId in userIds.Distinct())
        {
            try
            {
                await hubContext.Clients.Group(PlatformHub.GroupNames.ForUser(userId)).SendAsync("platformEvent", @event, ct);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to publish platformEvent to user:{UserId} (Topic={Topic}, Action={Action})", userId, @event.Topic, @event.Action);
            }
        }
    }

    public async Task PublishBadgeAsync(Guid userId, int pendingCount, CancellationToken ct = default)
    {
        try
        {
            var badgeEvent = new PlatformEvent("approvals", "badge", new { assignedToMePending = pendingCount });
            await hubContext.Clients.Group(PlatformHub.GroupNames.ForUser(userId)).SendAsync("platformEvent", badgeEvent, ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to publish badge update to user:{UserId}", userId);
        }
    }

    public void RequestKpiRefresh()
    {
        kpiCoalescer.RequestRefresh();
    }
}
