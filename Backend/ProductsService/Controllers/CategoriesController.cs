using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProductMarketplace.Api.Infrastructure.Approvals;
using ProductMarketplace.Api.Infrastructure.Security;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;

namespace ProductMarketplace.Api.Controllers;

[ApiController]
[Route("api/categories")]
[Authorize]
public class CategoriesController(ICategoryService service, ApprovalGate gate) : ControllerBase
{
    // Read by the catalogue and the product editor, not only by category managers.
    [HttpGet]
    [RequiresAnyCapability("categories:View", "products:View")]
    public async Task<IActionResult> Search([FromQuery] CategoryQueryDto query, CancellationToken ct)
        => Ok(await service.SearchAsync(query, ct));

    [HttpGet("{id:guid}")]
    [RequiresAnyCapability("categories:View", "products:View")]
    public async Task<ActionResult<CategoryDto>> GetById(Guid id, CancellationToken ct)
    {
        var category = await service.GetByIdAsync(id, ct);
        return category is null ? NotFound() : Ok(category);
    }

    [HttpPost]
    [RequiresCapability("categories", "Create")]
    public async Task<IActionResult> Create([FromBody] CategoryCreateUpdateDto dto, CancellationToken ct)
    {
        var pending = await gate.TrySubmitAsync(ProductsMutations.CategoryCreate, null, dto.Name, dto, ct);
        if (pending is not null) return Accepted(pending);

        var created = await service.CreateAsync(dto, ct);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    [HttpPut("{id:guid}")]
    [RequiresCapability("categories", "Edit")]
    public async Task<IActionResult> Update(Guid id, [FromBody] CategoryCreateUpdateDto dto, CancellationToken ct)
    {
        var current = await service.GetByIdAsync(id, ct);
        if (current is null) return NotFound();

        var pending = await gate.TrySubmitAsync(ProductsMutations.CategoryUpdate, id.ToString(), current.Name, dto, ct,
            before: new { name = current.Name, code = current.Code, status = current.Status });
        if (pending is not null) return Accepted(pending);

        var updated = await service.UpdateAsync(id, dto, ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    [HttpPost("{id:guid}/reorder")]
    [RequiresCapability("categories", "Edit")]
    public async Task<IActionResult> Reorder(Guid id, [FromBody] CategoryReorderDto dto, CancellationToken ct)
    {
        var current = await service.GetByIdAsync(id, ct);
        if (current is null) return NotFound();

        var pending = await gate.TrySubmitAsync(ProductsMutations.CategoryReorder, id.ToString(), current.Name, dto, ct);
        if (pending is not null) return Accepted(pending);

        var updated = await service.ReorderAsync(id, dto.Direction, ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    [HttpDelete("{id:guid}")]
    [RequiresCapability("categories", "Delete")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var current = await service.GetByIdAsync(id, ct);
        if (current is null) return NotFound();

        var pending = await gate.TrySubmitAsync(ProductsMutations.CategoryDelete, id.ToString(), current.Name, null, ct,
            before: new { name = current.Name });
        if (pending is not null) return Accepted(pending);

        return await service.DeleteAsync(id, ct) ? NoContent() : NotFound();
    }
}
