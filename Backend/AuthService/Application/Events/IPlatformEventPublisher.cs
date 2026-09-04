namespace AuthService.Application.Events;

/// <summary>
/// Abstraction for publishing platform-wide real-time push events via SignalR.
/// </summary>
public interface IPlatformEventPublisher
{
    Task PublishToApprovalViewersAsync(PlatformEvent @event, CancellationToken ct = default);
    Task PublishToAuditViewersAsync(PlatformEvent @event, CancellationToken ct = default);

    /// <summary>
    /// Checker-assignment changes, to the people gated on that capability specifically.
    /// <para>
    /// Separate from the approvals audience on purpose: the checker-assignment surface is guarded by
    /// its own, narrower capability, so publishing these to approvals.viewers reached a different set
    /// of people than the one allowed to see the data.
    /// </para>
    /// </summary>
    Task PublishToCheckerAssignmentViewersAsync(PlatformEvent @event, CancellationToken ct = default);
    Task PublishToUsersAsync(IEnumerable<Guid> userIds, PlatformEvent @event, CancellationToken ct = default);
    Task PublishBadgeAsync(Guid userId, int pendingCount, CancellationToken ct = default);
    void RequestKpiRefresh();
}
