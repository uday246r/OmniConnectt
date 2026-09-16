using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProductMarketplace.Api.Infrastructure.Approvals;
using ProductMarketplace.Api.Infrastructure.Security;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;

namespace ProductMarketplace.Api.Controllers;

/// <summary>
/// Customer applications and the documents attached to them.
/// </summary>
/// <remarks>
/// Every route here was anonymous. The list exposed customers' names, emails and phone numbers, and the
/// document route streamed the uploaded identity and income proofs to anyone who could guess or list
/// an id. Reading now needs <c>applications:View</c>; applying needs <c>products:Apply</c>.
/// </remarks>
[ApiController]
[Route("api/applications")]
[Authorize]
public class ApplicationsController(IApplicationService service, ApprovalGate gate) : ControllerBase
{
    [HttpGet]
    [RequiresCapability("applications", "View")]
    public async Task<IActionResult> Search([FromQuery] ApplicationQueryDto query, CancellationToken ct)
        => Ok(await service.SearchAsync(query, ct));

    /// <summary>Applications per status for the whole filtered set — the cards above the list.</summary>
    [HttpGet("status-counts")]
    [RequiresCapability("applications", "View")]
    public async Task<IActionResult> StatusCounts([FromQuery] ApplicationQueryDto query, CancellationToken ct)
        => Ok(await service.StatusCountsAsync(query, ct));

    [HttpGet("{id:guid}")]
    [RequiresCapability("applications", "View")]
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct)
    {
        var application = await service.GetByIdAsync(id, ct);
        return application is null ? NotFound() : Ok(application);
    }

    [HttpPost]
    [RequiresCapability("products", "Apply")]
    public async Task<IActionResult> Create([FromBody] ApplicationCreateDto dto, CancellationToken ct)
    {
        var created = await service.CreateAsync(dto, ct);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    [HttpPut("{id:guid}/status")]
    [RequiresCapability("applications", "Manage")]
    public async Task<IActionResult> UpdateStatus(Guid id, [FromBody] ApplicationStatusUpdateDto dto, CancellationToken ct)
    {
        var current = await service.GetByIdAsync(id, ct);
        if (current is null) return NotFound();

        var pending = await gate.TrySubmitAsync(ProductsMutations.ApplicationStatus, id.ToString(),
            $"Application {current.ApplicationNumber} ({current.CustomerName})", dto, ct, before: new { status = current.Status });
        if (pending is not null) return Accepted(pending);

        var updated = await service.UpdateStatusAsync(id, dto, ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    [HttpPost("{applicationId:guid}/documents/{documentId:guid}/upload")]
    [RequiresCapability("products", "Apply")]
    [RequestSizeLimit(Application.Common.DocumentUploadConstraints.MaxFileSizeBytes + 64 * 1024)]
    public async Task<IActionResult> UploadDocument(Guid applicationId, Guid documentId, IFormFile file, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new { message = "Please choose a file to upload." });

        await using var stream = file.OpenReadStream();
        var result = await service.UploadDocumentAsync(applicationId, documentId, file.FileName, file.ContentType, file.Length, stream, ct);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpGet("{applicationId:guid}/documents/{documentId:guid}/file")]
    [RequiresCapability("applications", "View")]
    public async Task<IActionResult> GetDocumentFile(Guid applicationId, Guid documentId, CancellationToken ct)
    {
        var result = await service.GetDocumentFileAsync(applicationId, documentId, ct);
        if (result is null) return NotFound();
        return File(result.Value.Stream, result.Value.ContentType, result.Value.FileName);
    }

    [HttpDelete("{applicationId:guid}/documents/{documentId:guid}/file")]
    [RequiresCapability("products", "Apply")]
    public async Task<IActionResult> RemoveDocumentFile(Guid applicationId, Guid documentId, CancellationToken ct)
    {
        var updated = await service.RemoveDocumentFileAsync(applicationId, documentId, ct);
        return updated is null ? NotFound() : Ok(updated);
    }
}
