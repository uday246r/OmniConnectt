using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProductMarketplace.Api.Infrastructure.Approvals;
using ProductMarketplace.Api.Infrastructure.Security;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;

namespace ProductMarketplace.Api.Controllers;

[ApiController]
[Route("api/employment-types")]
[Authorize]
public class EmploymentTypesController(IEmploymentTypeService service, ApprovalGate gate) : ControllerBase
{
    // The Apply form offers these as choices.
    [HttpGet]
    [RequiresAnyCapability("setup:View", "products:View", "applications:View")]
    public async Task<IActionResult> GetAll([FromQuery] bool? activeOnly, CancellationToken ct)
        => Ok(await service.GetAllAsync(activeOnly, ct));

    [HttpGet("{id:guid}")]
    [RequiresAnyCapability("setup:View", "products:View", "applications:View")]
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct)
    {
        var item = await service.GetByIdAsync(id, ct);
        return item is null ? NotFound() : Ok(item);
    }

    [HttpPost]
    [RequiresCapability("setup", "Manage")]
    public async Task<IActionResult> Create([FromBody] EmploymentTypeCreateUpdateDto dto, CancellationToken ct)
    {
        var pending = await gate.TrySubmitAsync(ProductsMutations.EmploymentTypeCreate, null, dto.Name, dto, ct);
        if (pending is not null) return Accepted(pending);

        var created = await service.CreateAsync(dto, ct);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    [HttpPut("{id:guid}")]
    [RequiresCapability("setup", "Manage")]
    public async Task<IActionResult> Update(Guid id, [FromBody] EmploymentTypeCreateUpdateDto dto, CancellationToken ct)
    {
        var current = await service.GetByIdAsync(id, ct);
        if (current is null) return NotFound();

        var pending = await gate.TrySubmitAsync(ProductsMutations.EmploymentTypeUpdate, id.ToString(), current.Name, dto, ct);
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

        var pending = await gate.TrySubmitAsync(ProductsMutations.EmploymentTypeDelete, id.ToString(), current.Name, null, ct,
            before: new { name = current.Name });
        if (pending is not null) return Accepted(pending);

        return await service.DeleteAsync(id, ct) ? NoContent() : NotFound();
    }
}
