namespace AuthService.Domain.Entities;

/// <summary>
/// Captures technical/operational events (errors, warnings, health checks, startup events).
/// This is separate from Audit Logs which track user/business actions.
/// </summary>
public class SystemLog
{
    public Guid Id { get; set; }
    public DateTimeOffset OccurredAt { get; set; }

    /// <summary>"Trace", "Debug", "Info", "Warning", "Error", "Critical"</summary>
    public required string Severity { get; set; }

    /// <summary>Which service recorded this — "AuthService", "ModuleRegistry", etc.</summary>
    public required string ServiceName { get; set; }

    /// <summary>e.g. "TokenRefresh", "HealthCheck", "Database"</summary>
    public string? Module { get; set; }

    /// <summary>from config, e.g. "Development", "Production"</summary>
    public string? Environment { get; set; }

    /// <summary>multi-tenant ready</summary>
    public string? TenantId { get; set; }

    /// <summary>optional user context</summary>
    public Guid? UserId { get; set; }

    /// <summary>from X-Correlation-Id or TraceIdentifier</summary>
    public string CorrelationId { get; set; } = string.Empty;

    /// <summary>ASP.NET TraceIdentifier</summary>
    public string? RequestId { get; set; }

    /// <summary>HTTP status code if request-scoped</summary>
    public int? StatusCode { get; set; }

    /// <summary>stable code like "AUTH_TOKEN_EXPIRED", "DB_CONNECTION_FAILED"</summary>
    public required string EventCode { get; set; }

    /// <summary>short human-readable message</summary>
    public required string Message { get; set; }

    /// <summary>sanitized stack trace</summary>
    public string? StackTrace { get; set; }

    /// <summary>JSON blob</summary>
    public string? Metadata { get; set; }
}
