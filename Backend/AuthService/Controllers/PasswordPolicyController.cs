using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Infrastructure.Security;
using AuthService.Infrastructure.Seed;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AuthService.Controllers;

/// <summary>
/// Viewing and editing the platform password policy. Gated by its OWN permission feature rather than
/// Settings &gt; Users: whoever shapes the user form is not necessarily who should decide how long a
/// credential lives. (The public, read-only view of the complexity rules that signed-in users need is
/// <c>GET /api/auth/password-policy</c>, which is deliberately not gated here.)
/// </summary>
[ApiController]
[Route("api/password-policy")]
[Authorize]
public class PasswordPolicyController(PasswordPolicyAppService policy) : ControllerBase
{
    private const string Feature = AuthDbSeeder.HostFeatureKeys.SettingsPasswordPolicy;

    [HttpGet]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<PasswordPolicyCatalogDto>> Get(CancellationToken ct)
        => Ok(await policy.GetAsync(ct));

    [HttpPut]
    [RequirePermission(Feature, "Edit")]
    public async Task<ActionResult<PasswordPolicyCatalogDto>> Update(
        [FromBody] UpdatePasswordPolicyRequest request, CancellationToken ct)
        => Ok(await policy.UpdateAsync(request, CurrentUserId(), ct));

    private Guid? CurrentUserId()
    {
        var sub = User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value;
        return Guid.TryParse(sub, out var id) ? id : null;
    }
}
