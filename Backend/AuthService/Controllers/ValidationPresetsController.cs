using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Infrastructure.Security;
using AuthService.Infrastructure.Seed;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AuthService.Controllers;

/// <summary>
/// Admin-defined, reusable validation "formats" (Settings > Manage Formats) — see
/// ValidationPresetCatalog's doc comment. Gated the same as UserSchemaController: this is part of
/// managing the user-creation form, not a separate permission.
/// </summary>
[ApiController]
[Route("api/validation-presets")]
[Authorize]
public class ValidationPresetsController(ValidationPresetAppService presets) : ControllerBase
{
    private const string Feature = AuthDbSeeder.HostFeatureKeys.SettingsUsers;

    [HttpGet]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<ValidationPresetCatalogDto>> Get(CancellationToken ct)
        => Ok(await presets.GetAsync(ct));

    [HttpPut]
    [RequirePermission(Feature, "Edit")]
    public async Task<ActionResult<ValidationPresetCatalogDto>> Update([FromBody] UpdateValidationPresetCatalogRequest request, CancellationToken ct)
        => Ok(await presets.UpdateAsync(request, CurrentUserId(), ct));

    private Guid? CurrentUserId()
    {
        var sub = User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value;
        return Guid.TryParse(sub, out var id) ? id : null;
    }
}
