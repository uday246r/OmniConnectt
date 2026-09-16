using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Infrastructure.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AuthService.Controllers;

/// <summary>
/// The Manage Formats catalog, for other services that validate against it.
/// </summary>
/// <remarks>
/// A format an administrator defines once (an employee code, an amount range) should mean the same
/// thing wherever a field uses it — a user profile here, a lead in LeadService. Those services check
/// submissions server-side, so they need the catalog itself, not just the browser's copy. Service key
/// only: the catalog is configuration, and the browser reads it through its own service's API.
/// </remarks>
[ApiController]
[Route("internal/validation-presets")]
[AllowAnonymous]
[TypeFilter(typeof(InternalApiKeyFilter))]
public class InternalValidationPresetsController(ValidationPresetAppService presets) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<ValidationPresetCatalogDto>> Get(CancellationToken ct) =>
        Ok(await presets.GetAsync(ct));
}
