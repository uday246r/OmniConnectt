using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProductMarketplace.Api.Infrastructure;
using ProductMarketplace.Api.Infrastructure.Security;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;

namespace ProductMarketplace.Api.Controllers;

[ApiController]
[Route("api/audit-logs")]
[Authorize]
[RequiresCapability("audit", "View")]
public class AuditLogsController(IAuditLogService service) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Search([FromQuery] AuditLogQueryDto query, CancellationToken ct)
        => Ok(await service.SearchAsync(query, ct));

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct)
    {
        var entry = await service.GetByIdAsync(id, ct);
        return entry is null ? NotFound() : Ok(entry);
    }

    [HttpGet("actions")]
    public async Task<IActionResult> GetActionOptions(CancellationToken ct)
        => Ok(await service.GetActionOptionsAsync(ct));

    /// <summary>Headline figures for the caller's current filters, computed across every matching row.</summary>
    [HttpGet("summary")]
    public async Task<IActionResult> GetSummary([FromQuery] AuditLogQueryDto query, CancellationToken ct)
        => Ok(await service.GetSummaryAsync(query, ct));

    [HttpGet("entity-types")]
    public async Task<IActionResult> GetEntityTypes(CancellationToken ct)
        => Ok(await service.GetEntityTypesAsync(ct));

    /// <summary>
    /// The filtered trail as a CSV file. Taking a copy off the platform is its own permission, and the
    /// export itself is recorded — who took it, how many rows, and with which filters.
    /// </summary>
    [HttpGet("export")]
    [RequiresFineCapability("audit", "Export")]
    public async Task<IActionResult> Export([FromQuery] AuditLogQueryDto query, [FromServices] IAuditLogService audit, CancellationToken ct)
    {
        var export = await service.ExportCsvAsync(query, ct);
        ExportHeaders.Apply(Response, export);

        await audit.LogAsync(
            "audit_log.export", "AuditLog", null, "Audit log",
            $"Downloaded {export.RowCount} audit entr{(export.RowCount == 1 ? "y" : "ies")}"
            + (export.Truncated ? $" (the newest {export.RowCount} of {export.MatchCount} matching — the download limit was reached)" : "")
            + $". Filters: {Describe(query)}.",
            ct: ct);

        return File(export.ToBytes(), "text/csv", $"products-audit-log-{DateTime.UtcNow:yyyyMMdd-HHmmss}.csv");
    }

    private static string Describe(AuditLogQueryDto q)
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(q.Search)) parts.Add($"search \"{q.Search}\"");
        if (!string.IsNullOrWhiteSpace(q.Action)) parts.Add($"action {q.Action}");
        if (!string.IsNullOrWhiteSpace(q.EntityType)) parts.Add($"record type {q.EntityType}");
        if (q.From is not null) parts.Add($"from {q.From:O}");
        if (q.To is not null) parts.Add($"to {q.To:O}");
        return parts.Count == 0 ? "none (the whole trail)" : string.Join(", ", parts);
    }
}
