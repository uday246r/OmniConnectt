using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProductMarketplace.Api.Infrastructure.Approvals;
using ProductMarketplace.Api.Infrastructure.Security;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;

namespace ProductMarketplace.Api.Controllers;

/// <summary>
/// Sub-categories — the kinds of product within a category — and the attributes each kind carries.
/// </summary>
[ApiController]
[Route("api/sub-categories")]
[Authorize]
public class SubCategoriesController(ISubCategoryService service, ApprovalGate gate) : ControllerBase
{
    // Read by the catalogue and the product editor (which renders its form from the fields), not only by
    // the people who manage sub-categories.
    [HttpGet]
    [RequiresAnyCapability("subcategories:View", "products:View")]
    public async Task<IActionResult> Search([FromQuery] SubCategoryQueryDto query, CancellationToken ct)
        => Ok(await service.SearchAsync(query, ct));

    [HttpGet("{id:guid}")]
    [RequiresAnyCapability("subcategories:View", "products:View", "setup:View")]
    public async Task<ActionResult<SubCategoryDetailDto>> GetById(Guid id, CancellationToken ct)
    {
        var sub = await service.GetByIdAsync(id, ct);
        return sub is null ? NotFound() : Ok(sub);
    }

    [HttpPost]
    [RequiresCapability("subcategories", "Create")]
    public async Task<IActionResult> Create([FromBody] SubCategoryCreateUpdateDto dto, CancellationToken ct)
    {
        var pending = await gate.TrySubmitAsync(ProductsMutations.SubCategoryCreate, null, dto.Name, dto, ct);
        if (pending is not null) return Accepted(pending);

        var created = await service.CreateAsync(dto, ct);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    [HttpPut("{id:guid}")]
    [RequiresCapability("subcategories", "Edit")]
    public async Task<IActionResult> Update(Guid id, [FromBody] SubCategoryCreateUpdateDto dto, CancellationToken ct)
    {
        var current = await service.GetByIdAsync(id, ct);
        if (current is null) return NotFound();

        var pending = await gate.TrySubmitAsync(ProductsMutations.SubCategoryUpdate, id.ToString(), current.Name, dto, ct,
            before: new { name = current.Name, code = current.Code, status = current.Status, categoryId = current.CategoryId });
        if (pending is not null) return Accepted(pending);

        var updated = await service.UpdateAsync(id, dto, ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    [HttpPost("{id:guid}/reorder")]
    [RequiresCapability("subcategories", "Edit")]
    public async Task<IActionResult> Reorder(Guid id, [FromBody] CategoryReorderDto dto, CancellationToken ct)
    {
        var current = await service.GetByIdAsync(id, ct);
        if (current is null) return NotFound();

        var pending = await gate.TrySubmitAsync(ProductsMutations.SubCategoryReorder, id.ToString(), current.Name, dto, ct);
        if (pending is not null) return Accepted(pending);

        var updated = await service.ReorderAsync(id, dto.Direction, ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    [HttpDelete("{id:guid}")]
    [RequiresCapability("subcategories", "Delete")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var current = await service.GetByIdAsync(id, ct);
        if (current is null) return NotFound();

        var pending = await gate.TrySubmitAsync(ProductsMutations.SubCategoryDelete, id.ToString(), current.Name, null, ct,
            before: new { name = current.Name });
        if (pending is not null) return Accepted(pending);

        return await service.DeleteAsync(id, ct) ? NoContent() : NotFound();
    }

    // ---- The attributes products of this sub-category carry -----------------------------------------

    [HttpPost("{id:guid}/fields")]
    [RequiresCapability("setup", "Manage")]
    public async Task<IActionResult> CreateField(Guid id, [FromBody] FieldDefinitionCreateUpdateDto dto, CancellationToken ct)
    {
        var sub = await service.GetByIdAsync(id, ct);
        if (sub is null) return NotFound();

        var pending = await gate.TrySubmitAsync(ProductsMutations.FieldCreate, id.ToString(), $"{dto.Label} ({sub.Name})", dto, ct);
        if (pending is not null) return Accepted(pending);

        var updated = await service.CreateFieldAsync(id, dto, ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    [HttpPut("{id:guid}/fields/{fieldId:guid}")]
    [RequiresCapability("setup", "Manage")]
    public async Task<IActionResult> UpdateField(Guid id, Guid fieldId, [FromBody] FieldDefinitionCreateUpdateDto dto, CancellationToken ct)
    {
        var sub = await service.GetByIdAsync(id, ct);
        if (sub is null) return NotFound();

        var pending = await gate.TrySubmitAsync(ProductsMutations.FieldUpdate, $"{id}/{fieldId}", $"{dto.Label} ({sub.Name})", dto, ct);
        if (pending is not null) return Accepted(pending);

        var updated = await service.UpdateFieldAsync(id, fieldId, dto, ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    [HttpDelete("{id:guid}/fields/{fieldId:guid}")]
    [RequiresCapability("setup", "Manage")]
    public async Task<IActionResult> DeleteField(Guid id, Guid fieldId, CancellationToken ct)
    {
        var sub = await service.GetByIdAsync(id, ct);
        if (sub is null) return NotFound();

        var field = sub.FieldDefinitions.FirstOrDefault(f => f.Id == fieldId);
        var pending = await gate.TrySubmitAsync(ProductsMutations.FieldDelete, $"{id}/{fieldId}",
            $"{field?.Label ?? "Field"} ({sub.Name})", null, ct);
        if (pending is not null) return Accepted(pending);

        var updated = await service.DeleteFieldAsync(id, fieldId, ct);
        return updated is null ? NotFound() : Ok(updated);
    }
}
