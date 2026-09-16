using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProductMarketplace.Api.Infrastructure.Approvals;
using ProductMarketplace.Api.Infrastructure.Security;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;

namespace ProductMarketplace.Api.Controllers;

[ApiController]
[Route("api/product-types")]
[Authorize]
public class ProductTypesController(IProductTypeService service, ApprovalGate gate) : ControllerBase
{
    // Reference data: the product editor and the Apply form read it too, not only Setup.
    [HttpGet]
    [RequiresAnyCapability("setup:View", "products:View")]
    public async Task<ActionResult<List<ProductTypeDto>>> GetAll(CancellationToken ct)
        => Ok(await service.GetAllAsync(ct));

    [HttpGet("{id:guid}")]
    [RequiresAnyCapability("setup:View", "products:View")]
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct)
    {
        var type = await service.GetByIdAsync(id, ct);
        return type is null ? NotFound() : Ok(type);
    }

    [HttpPost]
    [RequiresCapability("setup", "Manage")]
    public async Task<IActionResult> Create([FromBody] ProductTypeCreateUpdateDto dto, CancellationToken ct)
    {
        var pending = await gate.TrySubmitAsync(ProductsMutations.ProductTypeCreate, null, dto.Name, dto, ct);
        if (pending is not null) return Accepted(pending);

        var created = await service.CreateAsync(dto, ct);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    [HttpPut("{id:guid}")]
    [RequiresCapability("setup", "Manage")]
    public async Task<IActionResult> Update(Guid id, [FromBody] ProductTypeCreateUpdateDto dto, CancellationToken ct)
    {
        var current = await service.GetByIdAsync(id, ct);
        if (current is null) return NotFound();

        var pending = await gate.TrySubmitAsync(ProductsMutations.ProductTypeUpdate, id.ToString(), current.Name, dto, ct);
        if (pending is not null) return Accepted(pending);

        var updated = await service.UpdateAsync(id, dto, ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    [HttpDelete("{id:guid}")]
    [RequiresCapability("setup", "Manage")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var current = await service.GetByIdAsync(id, ct);
        if (current is null) return NotFound();

        var pending = await gate.TrySubmitAsync(ProductsMutations.ProductTypeDelete, id.ToString(), current.Name, null, ct,
            before: new { name = current.Name });
        if (pending is not null) return Accepted(pending);

        return await service.DeleteAsync(id, ct) ? NoContent() : NotFound();
    }

    [HttpPost("{id:guid}/fields")]
    [RequiresCapability("setup", "Manage")]
    public async Task<IActionResult> CreateField(Guid id, [FromBody] FieldDefinitionCreateUpdateDto dto, CancellationToken ct)
    {
        var type = await service.GetByIdAsync(id, ct);
        if (type is null) return NotFound();

        var pending = await gate.TrySubmitAsync(ProductsMutations.FieldCreate, id.ToString(), $"{dto.Label} ({type.Name})", dto, ct);
        if (pending is not null) return Accepted(pending);

        var updated = await service.CreateFieldAsync(id, dto, ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    [HttpPut("{id:guid}/fields/{fieldId:guid}")]
    [RequiresCapability("setup", "Manage")]
    public async Task<IActionResult> UpdateField(Guid id, Guid fieldId, [FromBody] FieldDefinitionCreateUpdateDto dto, CancellationToken ct)
    {
        var type = await service.GetByIdAsync(id, ct);
        if (type is null) return NotFound();

        var pending = await gate.TrySubmitAsync(ProductsMutations.FieldUpdate, $"{id}/{fieldId}", $"{dto.Label} ({type.Name})", dto, ct);
        if (pending is not null) return Accepted(pending);

        var updated = await service.UpdateFieldAsync(id, fieldId, dto, ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    [HttpDelete("{id:guid}/fields/{fieldId:guid}")]
    [RequiresCapability("setup", "Manage")]
    public async Task<IActionResult> DeleteField(Guid id, Guid fieldId, CancellationToken ct)
    {
        var type = await service.GetByIdAsync(id, ct);
        if (type is null) return NotFound();

        var field = type.FieldDefinitions.FirstOrDefault(f => f.Id == fieldId);
        var pending = await gate.TrySubmitAsync(ProductsMutations.FieldDelete, $"{id}/{fieldId}",
            $"{field?.Label ?? "Field"} ({type.Name})", null, ct);
        if (pending is not null) return Accepted(pending);

        var updated = await service.DeleteFieldAsync(id, fieldId, ct);
        return updated is null ? NotFound() : Ok(updated);
    }
}
