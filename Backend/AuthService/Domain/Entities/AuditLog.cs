namespace AuthService.Domain.Entities;

/// <summary>
/// One platform-wide audit entry. AuthService is the single sink every service writes to (directly
/// in-process for its own User/Role mutations, or via the internal API-key-protected endpoint for
/// everyone else — LeadService, Customer360Service, any future remote's backend) so "show me every
/// audit, host or remote" is one query against one table, not a fan-out across services.
/// </summary>
public class AuditLog
{
    public Guid Id { get; set; }
    public DateTimeOffset OccurredAt { get; set; }

    /// <summary>Which service recorded this — "AuthService", "LeadService", "Customer360Service", etc.</summary>
    public required string ServiceName { get; set; }

    public Guid? ActorUserId { get; set; }
    public string? ActorName { get; set; }

    /// <summary>Short verb-based action key, e.g. "user.created", "role.updated", "employee.deleted", "auth.login_succeeded", "auth.login_failed".</summary>
    public required string Action { get; set; }

    public string? EntityType { get; set; }
    public string? EntityId { get; set; }

    /// <summary>
    /// Human-readable name of the specific entity this action touched — e.g. a remote app's display
    /// name, a user's email, a role's name. Lets the UI show "Entity: Lead Management" instead of a
    /// raw EntityType/EntityId pair; falls back to EntityType alone when null (older rows, or actions
    /// with no single natural name).
    /// </summary>
    public string? EntityLabel { get; set; }

    /// <summary>Free-form JSON blob with whatever extra context is useful for this action — never parsed structurally, display-only.</summary>
    public string? Details { get; set; }

    public string? SourceIp { get; set; }

    /// <summary>"Local" or "Google" for login events; null for non-auth actions (user/role/remote-app mutations have no auth-method concept).</summary>
    public string? AuthMethod { get; set; }

    /// <summary>"Success" or "Failure". Defaults to Success — every non-login action written today only ever represents a completed mutation; login is the one action type that can genuinely fail and still get an audit row.</summary>
    public string Result { get; set; } = "Success";

    /// <summary>Real User-Agent request header, never fabricated. Null when the writer (an internal service call, not a browser request) has none to report.</summary>
    public string? UserAgent { get; set; }

    /// <summary>Populated only on real failure paths (invalid credentials, inactive account, disallowed SSO domain) — never a generic placeholder.</summary>
    public string? FailureReason { get; set; }

    /// <summary>A real per-request Guid, generated at write time if the caller doesn't supply one — lets support correlate a login failure row back to the request that produced it.</summary>
    public string CorrelationId { get; set; } = string.Empty;

    /// <summary>"Host", "Lead Management", "Customer 360" — which application generated this event.</summary>
    public string? SourceApplication { get; set; }

    /// <summary>"Host" or "Remote" — whether this came from the shell or a micro-frontend.</summary>
    public string? HostOrRemote { get; set; }

    /// <summary>The remote's container name, e.g. "lead_mf", "customer360_mf". Null for host events.</summary>
    public string? RemoteName { get; set; }

    /// <summary>Functional area, e.g. "Dashboard", "Lead Management", "Users", "Roles".</summary>
    public string? Module { get; set; }

    /// <summary>Specific page or view, e.g. "dashboard", "create-lead", "audit-logs".</summary>
    public string? Page { get; set; }

    /// <summary>"Navigation", "CRUD", "Export", "Search", "Filter", "Approval", "Auth".</summary>
    public string? ActionCategory { get; set; }
}
