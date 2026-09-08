using System.Text;
using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Infrastructure.Security;
using AuthService.Infrastructure.Seed;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AuthService.Controllers;

[ApiController]
[Route("api/audit-logs")]
[Authorize]
public class AuditLogsController(AuditLogAppService auditLog) : ControllerBase
{
    private const string Feature = AuthDbSeeder.HostFeatureKeys.SystemAuditLogs;

    [HttpGet]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<PagedResult<AuditLogDto>>> List(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 25,
        [FromQuery] string? service = null,
        [FromQuery] string? action = null,
        [FromQuery] string? result = null,
        [FromQuery] DateTimeOffset? from = null,
        [FromQuery] DateTimeOffset? to = null,
        [FromQuery] string? sortDir = null,
        [FromQuery] Guid? actorUserId = null,
        [FromQuery] string? correlationId = null,
        CancellationToken ct = default)
        => Ok(await auditLog.ListAsync(
            Math.Max(page, 1), Math.Clamp(pageSize, 1, 100), service, action, result, from, to, sortDir,
            actorUserId: actorUserId, correlationId: correlationId, ct: ct));

    [HttpGet("summary")]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<AuditLogSummaryDto>> Summary(
        [FromQuery] DateTimeOffset? from = null, [FromQuery] DateTimeOffset? to = null, CancellationToken ct = default)
        => Ok(await auditLog.SummaryAsync(from, to, ct));

    [HttpGet("export")]
    [RequirePermission(Feature, "Export")]
    public async Task<IActionResult> Export(
        [FromQuery] string? service = null,
        [FromQuery] string? action = null,
        [FromQuery] string? result = null,
        [FromQuery] DateTimeOffset? from = null,
        [FromQuery] DateTimeOffset? to = null,
        CancellationToken ct = default)
    {
        var csv = await auditLog.ExportCsvAsync(service, action, result, from, to, ct);
        var bytes = Encoding.UTF8.GetBytes(csv);
        return File(bytes, "text/csv", $"audit-logs-{DateTimeOffset.UtcNow:yyyyMMdd-HHmmss}.csv");
    }
}
