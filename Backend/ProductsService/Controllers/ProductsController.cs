using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProductMarketplace.Api.Infrastructure.Approvals;
using ProductMarketplace.Api.Infrastructure.Security;
using ProductMarketplace.Application.Common;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;

namespace ProductMarketplace.Api.Controllers;

[ApiController]
[Route("api/products")]
[Authorize]
public class ProductsController(IProductService service, ApprovalGate gate, IAuditLogService audit) : ControllerBase
{
    /// <summary>
    /// Every product matching the catalogue filters, as a CSV file. Replaces a browser-built file that held
    /// only the cards on the current page; the download is recorded in the audit trail.
    /// </summary>
    [HttpGet("export")]
    [RequiresCapability("products", "View")]
    [RequiresFineCapability("products", "Export")]
    public async Task<IActionResult> Export([FromQuery] ProductQueryDto query, CancellationToken ct)
    {
        var export = await service.ExportCsvAsync(query, ct);
        Infrastructure.ExportHeaders.Apply(Response, export);

        await audit.LogAsync("product.export", AuditEntityTypes.Product, null, "Product list",
            $"Downloaded {export.RowCount} product{(export.RowCount == 1 ? "" : "s")}"
            + (export.Truncated ? $" (the first {export.RowCount} of {export.MatchCount} matching — the download limit was reached)" : "")
            + (string.IsNullOrWhiteSpace(query.Search) ? "" : $" matching \"{query.Search}\"")
            + (string.IsNullOrWhiteSpace(query.Status) ? "" : $" with status {query.Status}")
            + ".", ct: ct);

        return File(export.ToBytes(), "text/csv", $"products-{DateTime.UtcNow:yyyyMMdd-HHmmss}.csv");
    }


    [HttpGet]
    [RequiresCapability("products", "View")]
    public async Task<IActionResult> Search([FromQuery] ProductQueryDto query, CancellationToken ct)
        => Ok(await service.SearchAsync(query, ct));

    [HttpGet("top-performers")]
    [RequiresCapability("products", "View")]
    public async Task<IActionResult> GetTopPerformers([FromQuery] string? metric, [FromQuery] int take, CancellationToken ct)
        => Ok(await service.GetTopPerformersAsync(string.IsNullOrWhiteSpace(metric) ? "applied" : metric, Paging.ClampTake(take, 5), ct));

    [HttpGet("{id:guid}")]
    [RequiresCapability("products", "View")]
    public async Task<IActionResult> GetById(Guid id, [FromQuery] bool trackView, CancellationToken ct)
    {
        var product = await service.GetByIdAsync(id, trackView, ct);
        return product is null ? NotFound() : Ok(product);
    }

    [HttpPost]
    [RequiresCapability("products", "Create")]
    public async Task<IActionResult> Create([FromBody] ProductCreateUpdateDto dto, CancellationToken ct)
    {
        var pending = await gate.TrySubmitAsync(ProductsMutations.ProductCreate, null, dto.Name, dto, ct);
        if (pending is not null) return Accepted(pending);

        var created = await service.CreateAsync(dto, ct);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    [HttpPut("{id:guid}")]
    [RequiresCapability("products", "Edit")]
    public async Task<IActionResult> Update(Guid id, [FromBody] ProductCreateUpdateDto dto, CancellationToken ct)
    {
        var current = await service.GetByIdAsync(id, false, ct);
        if (current is null) return NotFound();

        var pending = await gate.TrySubmitAsync(ProductsMutations.ProductUpdate, id.ToString(), current.Name, dto, ct);
        if (pending is not null) return Accepted(pending);

        var updated = await service.UpdateAsync(id, dto, ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    [HttpPatch("{id:guid}/status")]
    [RequiresCapability("products", "Edit")]
    public async Task<IActionResult> UpdateStatus(Guid id, [FromBody] ProductStatusUpdateDto dto, CancellationToken ct)
    {
        var current = await service.GetByIdAsync(id, false, ct);
        if (current is null) return NotFound();

        var pending = await gate.TrySubmitAsync(ProductsMutations.ProductStatus, id.ToString(), current.Name, dto, ct,
            before: new { status = current.Status });
        if (pending is not null) return Accepted(pending);

        var updated = await service.UpdateStatusAsync(id, dto.Status, ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    [HttpDelete("{id:guid}")]
    [RequiresCapability("products", "Delete")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var current = await service.GetByIdAsync(id, false, ct);
        if (current is null) return NotFound();

        var pending = await gate.TrySubmitAsync(ProductsMutations.ProductDelete, id.ToString(), current.Name, null, ct,
            before: new { name = current.Name, code = current.Code, status = current.Status });
        if (pending is not null) return Accepted(pending);

        return await service.DeleteAsync(id, ct) ? NoContent() : NotFound();
    }
}
