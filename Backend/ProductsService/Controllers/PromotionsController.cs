using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProductMarketplace.Api.Infrastructure.Approvals;
using ProductMarketplace.Api.Infrastructure.Security;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;

namespace ProductMarketplace.Api.Controllers;

[ApiController]
[Route("api/promotions")]
[Authorize]
public class PromotionsController(IPromotionService service, ApprovalGate gate) : ControllerBase
{
    [HttpGet]
    [RequiresAnyCapability("promotions:View", "products:View")]
    public async Task<IActionResult> Search([FromQuery] PromotionQueryDto query, CancellationToken ct)
        => Ok(await service.SearchAsync(query, ct));

    /// <summary>Promotions per status for the whole filtered set — the cards above the list.</summary>
    [HttpGet("status-counts")]
    [RequiresAnyCapability("promotions:View", "products:View")]
    public async Task<IActionResult> StatusCounts([FromQuery] PromotionQueryDto query, CancellationToken ct)
        => Ok(await service.StatusCountsAsync(query, ct));

    [HttpGet("{id:guid}")]
    [RequiresAnyCapability("promotions:View", "products:View")]
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct)
    {
        var promo = await service.GetByIdAsync(id, ct);
        return promo is null ? NotFound() : Ok(promo);
    }

    [HttpPost]
    [RequiresCapability("promotions", "Create")]
    public async Task<IActionResult> Create([FromBody] PromotionCreateUpdateDto dto, CancellationToken ct)
    {
        var pending = await gate.TrySubmitAsync(ProductsMutations.PromotionCreate, null, dto.Title, dto, ct);
        if (pending is not null) return Accepted(pending);

        var created = await service.CreateAsync(dto, ct);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    [HttpPut("{id:guid}")]
    [RequiresCapability("promotions", "Edit")]
    public async Task<IActionResult> Update(Guid id, [FromBody] PromotionCreateUpdateDto dto, CancellationToken ct)
    {
        var current = await service.GetByIdAsync(id, ct);
        if (current is null) return NotFound();

        var pending = await gate.TrySubmitAsync(ProductsMutations.PromotionUpdate, id.ToString(), current.Title, dto, ct);
        if (pending is not null) return Accepted(pending);

        var updated = await service.UpdateAsync(id, dto, ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    [HttpPatch("{id:guid}/status")]
    [RequiresCapability("promotions", "Edit")]
    public async Task<IActionResult> UpdateStatus(Guid id, [FromBody] PromotionStatusUpdateDto dto, CancellationToken ct)
    {
        var current = await service.GetByIdAsync(id, ct);
        if (current is null) return NotFound();

        var pending = await gate.TrySubmitAsync(ProductsMutations.PromotionStatus, id.ToString(), current.Title, dto, ct,
            before: new { status = current.Status });
        if (pending is not null) return Accepted(pending);

        var updated = await service.UpdateStatusAsync(id, dto.Status, ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    [HttpDelete("{id:guid}")]
    [RequiresCapability("promotions", "Delete")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var current = await service.GetByIdAsync(id, ct);
        if (current is null) return NotFound();

        var pending = await gate.TrySubmitAsync(ProductsMutations.PromotionDelete, id.ToString(), current.Title, null, ct,
            before: new { title = current.Title });
        if (pending is not null) return Accepted(pending);

        return await service.DeleteAsync(id, ct) ? NoContent() : NotFound();
    }
}
