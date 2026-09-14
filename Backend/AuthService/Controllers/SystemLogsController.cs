using System.Text;
using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Security;
using AuthService.Infrastructure.Seed;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AuthService.Controllers;

[ApiController]
[Route("api/system-logs")]
[Authorize]
public class SystemLogsController(SystemLogAppService systemLog, AuditLogAppService auditLog) : ControllerBase
{
    private const string Feature = AuthDbSeeder.HostFeatureKeys.SystemLogs;

    [HttpGet]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<PagedResult<SystemLogDto>>> List(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 25,
        [FromQuery] string? severity = null,
        [FromQuery] string? service = null,
        [FromQuery] string? module = null,
        [FromQuery] string? eventCode = null,
        [FromQuery] DateTimeOffset? from = null,
        [FromQuery] DateTimeOffset? to = null,
        [FromQuery] string? sortDir = null,
        [FromQuery] string? correlationId = null,
        [FromQuery] string? messageSearch = null,
        [FromQuery] string? environment = null,
        CancellationToken ct = default)
        => Ok(await systemLog.ListAsync(
            Math.Max(page, 1), Math.Clamp(pageSize, 1, 100), severity, service, module, eventCode,
            from, to, sortDir, correlationId, messageSearch, environment, ct));

    [HttpGet("summary")]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<SystemLogSummaryDto>> Summary(
        [FromQuery] DateTimeOffset? from = null, [FromQuery] DateTimeOffset? to = null, CancellationToken ct = default)
        => Ok(await systemLog.SummaryAsync(from, to, ct));

    [HttpGet("export")]
    [RequirePermission(Feature, "Export")]
    public async Task<IActionResult> Export(
        [FromQuery] string? severity = null,
        [FromQuery] string? service = null,
        [FromQuery] string? module = null,
        [FromQuery] string? eventCode = null,
        [FromQuery] DateTimeOffset? from = null,
        [FromQuery] DateTimeOffset? to = null,
        [FromQuery] string? correlationId = null,
        [FromQuery] string? sortDir = null,
        [FromQuery] string? messageSearch = null,
        [FromQuery] string? environment = null,
        CancellationToken ct = default)
    {
        var export = await systemLog.ExportCsvAsync(severity, service, module, eventCode, from, to,
            correlationId, sortDir, messageSearch, environment, ct);

        ExportHeaders.Apply(Response, export);

        // A system-log export is less sensitive than an audit-log one — it carries no business data —
        // but it does carry stack traces and correlation ids, and it still leaves the platform. It is
        // recorded for the same reason: so the trail can answer who took a copy of what.
        await auditLog.WriteHostAsync(
            CurrentUserId(), CurrentUserName(), "system_log.exported",
            AuditLogAppService.Modules.SystemLogs, AuditLogAppService.Categories.Export,
            entityType: "SystemLog", entityLabel: "System log",
            details: $"Exported {export.RowCount} system log row(s)" +
                     (export.Truncated
                         ? $" of {export.MatchCount} matching — the export limit of {export.RowLimit} was reached"
                         : "") +
                     $". Severity: {severity ?? "any"}; service: {service ?? "any"}; " +
                     $"from: {from?.ToString("O") ?? "any"}; to: {to?.ToString("O") ?? "any"}.",
            sourceIp: HttpContext.Connection.RemoteIpAddress?.ToString(),
            userAgent: Request.Headers.UserAgent.ToString() is { Length: > 0 } ua ? ua : null,
            page: "system-logs", ct: ct);

        return File(export.ToBytes(), "text/csv", $"system-logs-{DateTimeOffset.UtcNow:yyyyMMdd-HHmmss}.csv");
    }

    private Guid? CurrentUserId() =>
        Guid.TryParse(User.FindFirst("sub")?.Value, out var id) ? id : null;

    private string? CurrentUserName() =>
        User.FindFirst("name")?.Value ?? User.FindFirst("email")?.Value;
}
