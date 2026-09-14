using Microsoft.AspNetCore.Mvc;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;

namespace ProductMarketplace.Api.Controllers;

[ApiController]
[Route("api/applications")]
public class ApplicationsController : ControllerBase
{
    private readonly IApplicationService _service;
    public ApplicationsController(IApplicationService service) => _service = service;

    [HttpGet]
    public async Task<IActionResult> Search([FromQuery] ApplicationQueryDto query, CancellationToken ct)
        => Ok(await _service.SearchAsync(query, ct));

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct)
    {
        var application = await _service.GetByIdAsync(id, ct);
        return application is null ? NotFound() : Ok(application);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] ApplicationCreateDto dto, CancellationToken ct)
    {
        var created = await _service.CreateAsync(dto, ct);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    [HttpPut("{id:guid}/status")]
    public async Task<IActionResult> UpdateStatus(Guid id, [FromBody] ApplicationStatusUpdateDto dto, CancellationToken ct)
    {
        var updated = await _service.UpdateStatusAsync(id, dto, ct);
        return updated is null ? NotFound() : Ok(updated);
    }

    [HttpPost("{applicationId:guid}/documents/{documentId:guid}/upload")]
    public async Task<IActionResult> UploadDocument(Guid applicationId, Guid documentId, IFormFile file, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new { message = "File is required." });

        using var stream = file.OpenReadStream();
        var result = await _service.UploadDocumentAsync(applicationId, documentId, file.FileName, file.ContentType, file.Length, stream, ct);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpGet("{applicationId:guid}/documents/{documentId:guid}/file")]
    public async Task<IActionResult> GetDocumentFile(Guid applicationId, Guid documentId, CancellationToken ct)
    {
        var result = await _service.GetDocumentFileAsync(applicationId, documentId, ct);
        if (result is null) return NotFound();

        return File(result.Value.Stream, result.Value.ContentType, result.Value.FileName);
    }

    [HttpDelete("{applicationId:guid}/documents/{documentId:guid}/file")]
    public async Task<IActionResult> RemoveDocumentFile(Guid applicationId, Guid documentId, CancellationToken ct)
    {
        var updated = await _service.RemoveDocumentFileAsync(applicationId, documentId, ct);
        return updated is null ? NotFound() : Ok(updated);
    }
}
