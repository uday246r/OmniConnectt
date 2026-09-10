namespace AuthService.Application.DTOs;

public record SystemLogDto(
    Guid Id,
    DateTimeOffset OccurredAt,
    string Severity,
    string ServiceName,
    string? Module,
    string? Environment,
    string? TenantId,
    Guid? UserId,
    string CorrelationId,
    string? RequestId,
    int? StatusCode,
    string EventCode,
    string Message,
    string? StackTrace,
    string? Metadata);

public record RecordSystemLogRequest(
    string Severity,
    string ServiceName,
    string EventCode,
    string Message,
    string? Module = null,
    string? Environment = null,
    string? TenantId = null,
    Guid? UserId = null,
    string? CorrelationId = null,
    string? RequestId = null,
    int? StatusCode = null,
    string? StackTrace = null,
    string? Metadata = null);

public record SystemLogSummaryDto(
    int ErrorCount,
    int WarningCount,
    int InfoCount,
    int CriticalCount,
    int TotalEvents,
    int ServicesReporting);

