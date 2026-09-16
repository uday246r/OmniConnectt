using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProductMarketplace.Api.Infrastructure.Approvals;
using ProductMarketplace.Api.Infrastructure.Security;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;

namespace ProductMarketplace.Api.Controllers;

[ApiController]
[Route("api/document-definitions")]
[Authorize]
public class DocumentDefinitionsController(IDocumentDefinitionService service, ApprovalGate gate) : ControllerBase
{
    // The Apply form reads which documents a product requires.
    [HttpGet]
    [RequiresAnyCapability("setup:View", "products:View", "applications:View")]
    public async Task<IActionResult> GetAll([FromQuery] Guid? productTypeId, CancellationToken ct)
        => Ok(await service.GetAllAsync(productTypeId, ct));

    [HttpPost]
    [RequiresCapability("setup", "Manage")]
    public async Task<IActionResult> Create([FromBody] DocumentDefinitionCreateUpdateDto dto, CancellationToken ct)
    {
        var pending = await gate.TrySubmitAsync(ProductsMutations.DocumentDefinitionCreate, null, dto.Name, dto, ct);
        if (pending is not null) return Accepted(pending);

        return Ok(await service.CreateAsync(dto, ct));
    }

    [HttpPut("{id:guid}")]
    [RequiresCapability("setup", "Manage")]
    public async Task<IActionResult> Update(Guid id, [FromBody] DocumentDefinitionCreateUpdateDto dto, CancellationToken ct)
    {
        var pending = await gate.TrySubmitAsync(ProductsMutations.DocumentDefinitionUpdate, id.ToString(), dto.Name, dto, ct);
        if (pending is not null) return Accepted(pending);

        var updated = await service.UpdateAsync(id, dto, ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    [HttpDelete("{id:guid}")]
    [RequiresCapability("setup", "Manage")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var existing = (await service.GetAllAsync(null, ct)).FirstOrDefault(d => d.Id == id);
        if (existing is null) return NotFound();

        var pending = await gate.TrySubmitAsync(ProductsMutations.DocumentDefinitionDelete, id.ToString(), existing.Name, null, ct,
            before: new { name = existing.Name });
        if (pending is not null) return Accepted(pending);

        return await service.DeleteAsync(id, ct) ? NoContent() : NotFound();
    }
}
