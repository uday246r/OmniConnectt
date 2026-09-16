using System.ComponentModel.DataAnnotations;

namespace ProductMarketplace.Application.Dtos;

public class AuditLogDto
{
    public Guid Id { get; set; }
    public DateTime Timestamp { get; set; }
    public Guid? ActorUserId { get; set; }
    public string ActorName { get; set; } = string.Empty;
    public string ActorEmail { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;
    public string EntityType { get; set; } = string.Empty;
    public Guid? EntityId { get; set; }
    public string EntityName { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public bool Success { get; set; }
    public string? PreviousValue { get; set; }
    public string? NewValue { get; set; }
    public string? IpAddress { get; set; }
}

public class AuditLogQueryDto
{
    public string? Search { get; set; }
    public string? Action { get; set; }
    public string? EntityType { get; set; }
    /// <summary>Inclusive instants, as every log screen on the platform sends them.</summary>
    public DateTimeOffset? From { get; set; }
    public DateTimeOffset? To { get; set; }

    [Range(1, int.MaxValue, ErrorMessage = "Page must be 1 or greater.")]
    public int Page { get; set; } = 1;

    // Bounded so a caller cannot ask the API to materialise the entire audit ledger in one response.
    [Range(1, 200, ErrorMessage = "Page size must be between 1 and 200.")]
    public int PageSize { get; set; } = 10;
}

public class AuditActionOptionDto
{
    public string Value { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
}

/// <summary>
/// Aggregates computed across every row matching the caller's filters, not just the page being
/// displayed, so the headline figures describe the whole result set an admin is looking at.
/// </summary>
public class AuditLogSummaryDto
{
    public int TotalCount { get; set; }
    public int SuccessCount { get; set; }
    public int FailureCount { get; set; }
    public double SuccessRate { get; set; }
    public int ActionTypeCount { get; set; }
    public int EntityTypeCount { get; set; }
}
