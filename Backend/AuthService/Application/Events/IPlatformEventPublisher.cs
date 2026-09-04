namespace AuthService.Application.Events;

/// <summary>
/// Abstraction for publishing platform-wide real-time push events via SignalR.
/// </summary>
public interface IPlatformEventPublisher
{
    Task PublishToApprovalViewersAsync(PlatformEvent @event, CancellationToken ct = default);
    Task PublishToAuditViewersAsync(PlatformEvent @event, CancellationToken ct = default);
    Task PublishToUsersAsync(IEnumerable<Guid> userIds, PlatformEvent @event, CancellationToken ct = default);
    Task PublishBadgeAsync(Guid userId, int pendingCount, CancellationToken ct = default);
    void RequestKpiRefresh();
}
