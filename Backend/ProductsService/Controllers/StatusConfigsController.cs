using Microsoft.AspNetCore.Mvc;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;

namespace ProductMarketplace.Api.Controllers;

[ApiController]
[Route("api/status-configs")]
public class StatusConfigsController : ControllerBase
{
    private readonly IStatusConfigService _service;
    public StatusConfigsController(IStatusConfigService service) => _service = service;

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] string? entityType, CancellationToken ct)
        => Ok(await _service.GetAllAsync(entityType, ct));

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] StatusConfigCreateDto dto, CancellationToken ct)
    {
        var created = await _service.CreateAsync(dto, ct);
        return Ok(created);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, [FromBody] StatusConfigUpdateDto dto, CancellationToken ct)
    {
        var updated = await _service.UpdateAsync(id, dto, ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var deleted = await _service.DeleteAsync(id, ct);
        return deleted ? NoContent() : NotFound();
    }
}
