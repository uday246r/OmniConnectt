using System.Text;
using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Infrastructure.Security;
using AuthService.Infrastructure.Seed;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AuthService.Controllers;

[ApiController]
[Route("api/system-logs")]
[Authorize]
public class SystemLogsController(SystemLogAppService systemLog) : ControllerBase
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
        var csv = await systemLog.ExportCsvAsync(severity, service, module, eventCode, from, to,
            correlationId, sortDir, messageSearch, environment, ct);
        var bytes = Encoding.UTF8.GetBytes(csv);
        return File(bytes, "text/csv", $"system-logs-{DateTimeOffset.UtcNow:yyyyMMdd-HHmmss}.csv");
    }
}
