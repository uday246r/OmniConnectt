using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProductMarketplace.Api.Infrastructure.Approvals;
using ProductMarketplace.Api.Infrastructure.Security;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;

namespace ProductMarketplace.Api.Controllers;

[ApiController]
[Route("api/reviews")]
[Authorize]
public class ReviewsController(IReviewService service, ApprovalGate gate) : ControllerBase
{
    [HttpGet]
    [RequiresAnyCapability("reviews:View", "products:View")]
    public async Task<IActionResult> Search([FromQuery] ReviewQueryDto query, CancellationToken ct)
        => Ok(await service.SearchAsync(query, ct));

    [HttpGet("{id:guid}")]
    [RequiresAnyCapability("reviews:View", "products:View")]
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct)
    {
        var review = await service.GetByIdAsync(id, ct);
        return review is null ? NotFound() : Ok(review);
    }

    [HttpPost]
    [RequiresCapability("reviews", "Create")]
    public async Task<IActionResult> Create([FromBody] ReviewCreateDto dto, CancellationToken ct)
    {
        var created = await service.CreateAsync(dto, ct);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    [HttpPatch("{id:guid}/status")]
    [RequiresCapability("reviews", "Moderate")]
    public async Task<IActionResult> UpdateStatus(Guid id, [FromBody] ReviewStatusUpdateDto dto, CancellationToken ct)
    {
        var current = await service.GetByIdAsync(id, ct);
        if (current is null) return NotFound();

        var pending = await gate.TrySubmitAsync(ProductsMutations.ReviewStatus, id.ToString(),
            $"Review by {current.CustomerName} on {current.ProductName}", dto, ct, before: new { status = current.Status });
        if (pending is not null) return Accepted(pending);

        var updated = await service.UpdateStatusAsync(id, dto.Status, ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    [HttpDelete("{id:guid}")]
    [RequiresCapability("reviews", "Delete")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var current = await service.GetByIdAsync(id, ct);
        if (current is null) return NotFound();

        var pending = await gate.TrySubmitAsync(ProductsMutations.ReviewDelete, id.ToString(),
            $"Review by {current.CustomerName} on {current.ProductName}", null, ct);
        if (pending is not null) return Accepted(pending);

        return await service.DeleteAsync(id, ct) ? NoContent() : NotFound();
    }
}
