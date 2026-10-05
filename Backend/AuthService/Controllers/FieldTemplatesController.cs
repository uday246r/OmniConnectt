using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Infrastructure.Security;
using AuthService.Infrastructure.Seed;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AuthService.Controllers;

/// <summary>
/// Controller for viewing and managing field templates (options for dropdowns like countries, departments, custom catalogs).
/// Gated by Settings > Users permissions.
/// </summary>
[ApiController]
[Route("api/field-templates")]
[Authorize]
public class FieldTemplatesController(FieldTemplateAppService templates) : ControllerBase
{
    private const string Feature = AuthDbSeeder.HostFeatureKeys.SettingsUsers;

    [HttpGet]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<FieldTemplateCatalogDto>> Get(CancellationToken ct)
        => Ok(await templates.GetAsync(ct));

    [HttpPut]
    [RequirePermission(Feature, "Edit")]
    public async Task<ActionResult<FieldTemplateCatalogDto>> Update(
        [FromBody] UpdateFieldTemplateCatalogRequest request, CancellationToken ct)
        => Ok(await templates.UpdateAsync(request, CurrentUserId(), ct));

    private Guid? CurrentUserId()
    {
        var sub = User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value;
        return Guid.TryParse(sub, out var id) ? id : null;
    }
}
