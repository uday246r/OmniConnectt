namespace AuthService.Application.Exceptions;

public class NotFoundAppException(string message) : Exception(message);

public class ConflictAppException(string message) : Exception(message);

public class ValidationAppException(string message) : Exception(message);

/// <summary>The caller is authenticated and holds the general capability, but is not the specific
/// person allowed to act on this specific record — e.g. a checker who isn't the one assigned to this
/// approval request, or a maker attempting to approve their own request.</summary>
public class ForbiddenAppException(string message) : Exception(message);

/// <summary>
/// A gated mutation was refused because the target record already has an open approval request.
/// Carries the blocking request's details so the UI can show what is pending and with whom, rather
/// than a bare conflict message. Maps to 409 with a <c>pendingRequest</c> ProblemDetails extension.
/// </summary>
public class PendingApprovalConflictException(string message, DTOs.PendingApprovalConflictDto pending)
    : Exception(message)
{
    public DTOs.PendingApprovalConflictDto Pending { get; } = pending;
}

/// <summary>The resource genuinely existed and is permanently gone by design — not "not found"
/// (which implies it may never have existed) and not "conflict" (which implies retrying
/// differently could work). Today: a one-time secret that has already been collected.</summary>
public class GoneAppException(string message) : Exception(message);
