using Microsoft.AspNetCore.Mvc;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;

namespace ProductMarketplace.Api.Controllers;

[ApiController]
[Route("api/audit-logs")]
public class AuditLogsController : ControllerBase
{
    private readonly IAuditLogService _service;
    public AuditLogsController(IAuditLogService service) => _service = service;

    [HttpGet]
    public async Task<IActionResult> Search([FromQuery] AuditLogQueryDto query, CancellationToken ct)
        => Ok(await _service.SearchAsync(query, ct));

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct)
    {
        var entry = await _service.GetByIdAsync(id, ct);
        return entry is null ? NotFound() : Ok(entry);
    }

    [HttpGet("actions")]
    public async Task<IActionResult> GetActionOptions(CancellationToken ct)
        => Ok(await _service.GetActionOptionsAsync(ct));

    /// <summary>Headline figures for the caller's current filters, computed across every matching row.</summary>
    [HttpGet("summary")]
    public async Task<IActionResult> GetSummary([FromQuery] AuditLogQueryDto query, CancellationToken ct)
        => Ok(await _service.GetSummaryAsync(query, ct));

    [HttpGet("entity-types")]
    public async Task<IActionResult> GetEntityTypes(CancellationToken ct)
        => Ok(await _service.GetEntityTypesAsync(ct));
}
