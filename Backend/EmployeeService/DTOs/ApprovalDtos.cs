namespace EmployeeService.DTOs;

/// <summary>
/// Returned instead of the normal success body whenever a mutation was gated and could not be applied
/// directly (HTTP 202). Mirrors AuthService's own ApprovalPendingDto shape field-for-field — the host
/// frontend's isApprovalPending() type guard reads approvalRequestId/message off whatever any service
/// returns, so the JSON shape matters even without a shared package.
/// </summary>
public class ApprovalPendingDto
{
    public Guid ApprovalRequestId { get; set; }
    public string Module { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;
    public string CheckerName { get; set; } = string.Empty;
    public string Message { get; set; } = "Request submitted for approval.";
}

/// <summary>
/// Wraps every gated EmployeeService mutation result. Exactly one of the two is set, so the ungated
/// JSON response stays byte-identical to today and no existing consumer sees a change.
/// </summary>
public class MutationResult<T>
{
    public T? Applied { get; set; }
    public ApprovalPendingDto? Pending { get; set; }

    public static MutationResult<T> Ok(T applied) => new() { Applied = applied };
    public static MutationResult<T> PendingApproval(ApprovalPendingDto pending) => new() { Pending = pending };
}

/// <summary>
/// Payload AuthService POSTs to internal/approvals/apply to replay an approved mutation that
/// originated here. Mirrors AuthService's own ApplyApprovedMutationRequest field-for-field.
/// </summary>
public class ApplyApprovedMutationRequest
{
    public string Module { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;
    public string? EntityType { get; set; }
    public string? EntityId { get; set; }
    public string NewDataJson { get; set; } = string.Empty;
    public Guid ActingUserId { get; set; }
    public string? ActingUserName { get; set; }
    public string? CorrelationId { get; set; }
}

/// <summary>
/// Raised when a mutation should have been gated but AuthService could not be reached to record it.
///
/// This must surface as an error rather than silently applying the change: falling back to "just do
/// it" would let anyone bypass approval entirely by making AuthService unreachable, which turns an
/// outage into a privilege-escalation route.
/// </summary>
public class ApprovalServiceUnavailableException(string message) : Exception(message);
