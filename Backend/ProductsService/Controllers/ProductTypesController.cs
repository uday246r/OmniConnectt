using Microsoft.AspNetCore.Mvc;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;

namespace ProductMarketplace.Api.Controllers;

[ApiController]
[Route("api/product-types")]
public class ProductTypesController : ControllerBase
{
    private readonly IProductTypeService _service;
    public ProductTypesController(IProductTypeService service) => _service = service;

    [HttpGet]
    public async Task<ActionResult<List<ProductTypeDto>>> GetAll(CancellationToken ct)
        => Ok(await _service.GetAllAsync(ct));

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct)
    {
        var type = await _service.GetByIdAsync(id, ct);
        return type is null ? NotFound() : Ok(type);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] ProductTypeCreateUpdateDto dto, CancellationToken ct)
    {
        var created = await _service.CreateAsync(dto, ct);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, [FromBody] ProductTypeCreateUpdateDto dto, CancellationToken ct)
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

    [HttpPost("{id:guid}/fields")]
    public async Task<IActionResult> CreateField(Guid id, [FromBody] FieldDefinitionCreateUpdateDto dto, CancellationToken ct)
    {
        var updated = await _service.CreateFieldAsync(id, dto, ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    [HttpPut("{id:guid}/fields/{fieldId:guid}")]
    public async Task<IActionResult> UpdateField(Guid id, Guid fieldId, [FromBody] FieldDefinitionCreateUpdateDto dto, CancellationToken ct)
    {
        var updated = await _service.UpdateFieldAsync(id, fieldId, dto, ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    [HttpDelete("{id:guid}/fields/{fieldId:guid}")]
    public async Task<IActionResult> DeleteField(Guid id, Guid fieldId, CancellationToken ct)
    {
        var updated = await _service.DeleteFieldAsync(id, fieldId, ct);
        return updated is null ? NotFound() : Ok(updated);
    }
}
