using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProductMarketplace.Api.Infrastructure.Approvals;
using ProductMarketplace.Api.Infrastructure.Security;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;

namespace ProductMarketplace.Api.Controllers;

[ApiController]
[Route("api/status-configs")]
[Authorize]
public class StatusConfigsController(IStatusConfigService service, ApprovalGate gate) : ControllerBase
{
    // Every list screen reads status labels and colours to draw its badges.
    [HttpGet]
    [RequiresAnyCapability("setup:View", "products:View", "categories:View", "promotions:View", "applications:View", "reviews:View")]
    public async Task<IActionResult> GetAll([FromQuery] string? entityType, CancellationToken ct)
        => Ok(await service.GetAllAsync(entityType, ct));

    [HttpPost]
    [RequiresCapability("setup", "Manage")]
    public async Task<IActionResult> Create([FromBody] StatusConfigCreateDto dto, CancellationToken ct)
    {
        var pending = await gate.TrySubmitAsync(ProductsMutations.StatusConfigCreate, null, $"{dto.Label} ({dto.EntityType})", dto, ct);
        if (pending is not null) return Accepted(pending);

        return Ok(await service.CreateAsync(dto, ct));
    }

    [HttpPut("{id:guid}")]
    [RequiresCapability("setup", "Manage")]
    public async Task<IActionResult> Update(Guid id, [FromBody] StatusConfigUpdateDto dto, CancellationToken ct)
    {
        var existing = (await service.GetAllAsync(null, ct)).FirstOrDefault(s => s.Id == id);
        if (existing is null) return NotFound();

        var pending = await gate.TrySubmitAsync(ProductsMutations.StatusConfigUpdate, id.ToString(), $"{existing.Label} ({existing.EntityType})", dto, ct);
        if (pending is not null) return Accepted(pending);

        var updated = await service.UpdateAsync(id, dto, ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    [HttpDelete("{id:guid}")]
    [RequiresCapability("setup", "Manage")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var existing = (await service.GetAllAsync(null, ct)).FirstOrDefault(s => s.Id == id);
        if (existing is null) return NotFound();

        var pending = await gate.TrySubmitAsync(ProductsMutations.StatusConfigDelete, id.ToString(), $"{existing.Label} ({existing.EntityType})", null, ct);
        if (pending is not null) return Accepted(pending);

        return await service.DeleteAsync(id, ct) ? NoContent() : NotFound();
    }
}
