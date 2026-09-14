using System.Text;
using AuthService.Application.DTOs;
using AuthService.Domain.Entities;
using AuthService.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace AuthService.Application.Services;

public class SystemLogAppService(AuthDbContext db, IConfiguration config)
{
    private readonly string? _environment = config["Environment"] ?? config["ASPNETCORE_ENVIRONMENT"];

    public async Task WriteAsync(
        string severity, string serviceName, string eventCode, string message,
        string? module = null, string? environment = null, string? tenantId = null,
        Guid? userId = null, string? correlationId = null, string? requestId = null,
        int? statusCode = null, string? stackTrace = null, string? metadata = null,
        CancellationToken ct = default)
    {
        db.SystemLogs.Add(new SystemLog
        {
            Id = Guid.NewGuid(),
            OccurredAt = DateTimeOffset.UtcNow,
            Severity = severity,
            ServiceName = serviceName,
            Module = module,
            Environment = environment ?? _environment,
            TenantId = tenantId,
            UserId = userId,
            CorrelationId = correlationId ?? Guid.NewGuid().ToString(),
            RequestId = requestId,
            StatusCode = statusCode,
            EventCode = eventCode,
            Message = SecretRedactor.Redact(message) ?? string.Empty,
            StackTrace = SecretRedactor.Redact(stackTrace),
            Metadata = metadata
        });
        await db.SaveChangesAsync(ct);
    }

    public Task WriteAsync(RecordSystemLogRequest req, CancellationToken ct = default) =>
        WriteAsync(req.Severity, req.ServiceName, req.EventCode, req.Message, req.Module, req.Environment,
            req.TenantId, req.UserId, req.CorrelationId, req.RequestId, req.StatusCode, req.StackTrace, req.Metadata, ct);

    public async Task<PagedResult<SystemLogDto>> ListAsync(
        int page = 1, int pageSize = 25, string? severity = null, string? service = null, string? module = null,
        string? eventCode = null, DateTimeOffset? from = null, DateTimeOffset? to = null, string? sortDir = null,
        string? correlationId = null, string? messageSearch = null, string? environment = null,
        CancellationToken ct = default)
    {
        var query = BuildFilteredQuery(severity, service, module, eventCode, from, to, correlationId, messageSearch, environment);
        var total = await query.CountAsync(ct);
        var ordered = string.Equals(sortDir, "asc", StringComparison.OrdinalIgnoreCase)
            ? query.OrderBy(a => a.OccurredAt)
            : query.OrderByDescending(a => a.OccurredAt);
        var items = await ordered
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(a => ToDto(a))
            .ToListAsync(ct);
        return new PagedResult<SystemLogDto>(items, total, page, pageSize);
    }

    public async Task<SystemLogSummaryDto> SummaryAsync(DateTimeOffset? from = null, DateTimeOffset? to = null, CancellationToken ct = default)
    {
        var query = BuildFilteredQuery(null, null, null, null, from, to, null, null, null);
        var errorCount = await query.CountAsync(a => a.Severity == "Error" || a.Severity == "Critical", ct);
        var warningCount = await query.CountAsync(a => a.Severity == "Warning", ct);
        var infoCount = await query.CountAsync(a => a.Severity == "Info" || a.Severity == "Debug" || a.Severity == "Trace", ct);
        var criticalCount = await query.CountAsync(a => a.Severity == "Critical", ct);
        var totalEvents = await query.CountAsync(ct);
        var servicesReporting = await query.Select(a => a.ServiceName).Distinct().CountAsync(ct);
        return new SystemLogSummaryDto(errorCount, warningCount, infoCount, criticalCount, totalEvents, servicesReporting);
    }

    /// <summary>
    /// CSV of the current filtered result set, capped — and reporting that it capped.
    /// </summary>
    /// <remarks>
    /// This method's filter set was already symmetric with the list's, which is why the System Logs
    /// export never had the "the CSV does not match the screen" problem the audit export did. What it
    /// shared with every other export on the platform was the silent truncation: it returned the
    /// newest 10,000 rows of a larger match with no indication that anything was missing.
    /// </remarks>
    public async Task<CsvExport> ExportCsvAsync(
        string? severity = null, string? service = null, string? module = null, string? eventCode = null,
        DateTimeOffset? from = null, DateTimeOffset? to = null, string? correlationId = null,
        string? sortDir = null, string? messageSearch = null, string? environment = null,
        CancellationToken ct = default)
    {
        const int maxRows = 10_000;
        var baseQuery = BuildFilteredQuery(severity, service, module, eventCode, from, to, correlationId, messageSearch, environment);

        var matched = await baseQuery.CountAsync(ct);

        var items = await (string.Equals(sortDir, "asc", StringComparison.OrdinalIgnoreCase)
            ? baseQuery.OrderBy(a => a.OccurredAt)
            : baseQuery.OrderByDescending(a => a.OccurredAt))
            .Take(maxRows).ToListAsync(ct);

        var csv = new CsvBuilder(
            "Time", "Severity", "Service", "Module", "Environment", "TenantId", "UserId",
            "CorrelationId", "RequestId", "StatusCode", "EventCode", "Message", "StackTrace", "Metadata");

        foreach (var a in items)
        {
            csv.AppendRow(
                a.OccurredAt.ToString("O"), a.Severity, a.ServiceName,
                a.Module, a.Environment, a.TenantId, a.UserId?.ToString(),
                // Unlike the audit export, the correlation id belongs here: a system log is a
                // diagnostic artifact, and correlating one across services is the main reason anyone
                // exports it.
                a.CorrelationId, a.RequestId, a.StatusCode?.ToString(),
                a.EventCode, a.Message, a.StackTrace, a.Metadata);
        }

        return new CsvExport(csv.ToString(), items.Count, matched, maxRows);
    }

    private IQueryable<SystemLog> BuildFilteredQuery(
        string? severity, string? service, string? module, string? eventCode,
        DateTimeOffset? from, DateTimeOffset? to, string? correlationId,
        string? messageSearch, string? environment)
    {
        var query = db.SystemLogs.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(severity))
        {
            if (string.Equals(severity, "Error", StringComparison.OrdinalIgnoreCase))
                query = query.Where(a => a.Severity == "Error" || a.Severity == "Critical");
            else
                query = query.Where(a => a.Severity == severity);
        }
        if (!string.IsNullOrWhiteSpace(service)) query = query.Where(a => a.ServiceName == service);
        if (!string.IsNullOrWhiteSpace(module)) query = query.Where(a => a.Module == module);
        if (!string.IsNullOrWhiteSpace(eventCode)) query = query.Where(a => a.EventCode == eventCode);
        if (!string.IsNullOrWhiteSpace(correlationId)) query = query.Where(a => a.CorrelationId == correlationId);
        if (!string.IsNullOrWhiteSpace(messageSearch))
            query = query.Where(a => EF.Functions.ILike(a.Message, $"%{messageSearch}%"));
        if (!string.IsNullOrWhiteSpace(environment)) query = query.Where(a => a.Environment == environment);
        if (from is not null) query = query.Where(a => a.OccurredAt >= from);
        if (to is not null) query = query.Where(a => a.OccurredAt <= to);
        return query;
    }

    private static string CsvField(string? value)
    {
        var text = value ?? string.Empty;
        return text.Contains(',') || text.Contains('"') || text.Contains('\n')
            ? $"\"{text.Replace("\"", "\"\"")}\""
            : text;
    }

    private static SystemLogDto ToDto(SystemLog a) => new(
        a.Id, a.OccurredAt, a.Severity, a.ServiceName, a.Module, a.Environment,
        a.TenantId, a.UserId, a.CorrelationId, a.RequestId, a.StatusCode,
        a.EventCode, a.Message, a.StackTrace, a.Metadata);
}
