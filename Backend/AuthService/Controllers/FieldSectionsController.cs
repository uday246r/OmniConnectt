using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Infrastructure.Security;
using AuthService.Infrastructure.Seed;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AuthService.Controllers;

/// <summary>
/// Controller for viewing and managing the form-section catalog. Gated by Settings > Users, the same
/// permission as the field schema it groups — sections are part of "what the user form collects", not a
/// separate concern.
/// </summary>
[ApiController]
[Route("api/field-sections")]
[Authorize]
public class FieldSectionsController(FieldSectionAppService sections) : ControllerBase
{
    private const string Feature = AuthDbSeeder.HostFeatureKeys.SettingsUsers;

    [HttpGet]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<FieldSectionCatalogDto>> Get(CancellationToken ct)
        => Ok(await sections.GetAsync(ct));

    [HttpPut]
    [RequirePermission(Feature, "Edit")]
    public async Task<ActionResult<FieldSectionCatalogDto>> Update(
        [FromBody] UpdateFieldSectionCatalogRequest request, CancellationToken ct)
        => Ok(await sections.UpdateAsync(request, CurrentUserId(), ct));

    private Guid? CurrentUserId()
    {
        var sub = User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value;
        return Guid.TryParse(sub, out var id) ? id : null;
    }
}
