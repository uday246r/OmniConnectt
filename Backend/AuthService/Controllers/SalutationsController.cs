using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Infrastructure.Security;
using AuthService.Infrastructure.Seed;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AuthService.Controllers;

/// <summary>Admin-configurable salutation list (Mr., Ms., ...) — see SalutationCatalog's doc comment.
/// Gated the same as UserSchemaController/ValidationPresetsController.</summary>
[ApiController]
[Route("api/salutations")]
[Authorize]
public class SalutationsController(SalutationAppService salutations) : ControllerBase
{
    private const string Feature = AuthDbSeeder.HostFeatureKeys.SettingsUsers;

    [HttpGet]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<SalutationCatalogDto>> Get(CancellationToken ct)
        => Ok(await salutations.GetAsync(ct));

    [HttpPut]
    [RequirePermission(Feature, "Edit")]
    public async Task<ActionResult<SalutationCatalogDto>> Update([FromBody] UpdateSalutationCatalogRequest request, CancellationToken ct)
        => Ok(await salutations.UpdateAsync(request, CurrentUserId(), ct));

    private Guid? CurrentUserId()
    {
        var sub = User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value;
        return Guid.TryParse(sub, out var id) ? id : null;
    }
}
