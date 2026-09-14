using Microsoft.AspNetCore.Mvc;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;

namespace ProductMarketplace.Api.Controllers;

[ApiController]
[Route("api/products")]
public class ProductsController : ControllerBase
{
    private readonly IProductService _service;
    public ProductsController(IProductService service) => _service = service;

    [HttpGet]
    public async Task<IActionResult> Search([FromQuery] ProductQueryDto query, CancellationToken ct)
        => Ok(await _service.SearchAsync(query, ct));

    [HttpGet("top-performers")]
    public async Task<IActionResult> GetTopPerformers([FromQuery] string metric, [FromQuery] int take, CancellationToken ct)
        => Ok(await _service.GetTopPerformersAsync(string.IsNullOrWhiteSpace(metric) ? "applied" : metric, take <= 0 ? 5 : take, ct));

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById(Guid id, [FromQuery] bool trackView, CancellationToken ct)
    {
        var product = await _service.GetByIdAsync(id, trackView, ct);
        return product is null ? NotFound() : Ok(product);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] ProductCreateUpdateDto dto, CancellationToken ct)
    {
        var created = await _service.CreateAsync(dto, ct);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, [FromBody] ProductCreateUpdateDto dto, CancellationToken ct)
    {
        var updated = await _service.UpdateAsync(id, dto, ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    [HttpPatch("{id:guid}/status")]
    public async Task<IActionResult> UpdateStatus(Guid id, [FromBody] ProductStatusUpdateDto dto, CancellationToken ct)
    {
        var updated = await _service.UpdateStatusAsync(id, dto.Status, ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var deleted = await _service.DeleteAsync(id, ct);
        return deleted ? NoContent() : NotFound();
    }
}
