using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Infrastructure.Security;
using AuthService.Infrastructure.Seed;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AuthService.Controllers;

/// <summary>
/// The admin-configurable "which fields does Create/Edit User collect, and what validates them" schema
/// — see UserFieldSchema's doc comment. Gated by the same Users feature/capabilities as UsersController
/// itself: managing the fields on the user form is naturally part of the same Settings > Users
/// capability, not a separate permission to seed and expose in the role editor.
/// </summary>
[ApiController]
[Route("api/user-schema")]
[Authorize]
public class UserSchemaController(UserFieldSchemaAppService schema) : ControllerBase
{
    private const string Feature = AuthDbSeeder.HostFeatureKeys.SettingsUsers;

    [HttpGet]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<UserFieldSchemaDto>> Get(CancellationToken ct)
        => Ok(await schema.GetAsync(ct));

    [HttpPut]
    [RequirePermission(Feature, "Edit")]
    public async Task<ActionResult<UserFieldSchemaDto>> Update([FromBody] UpdateUserFieldSchemaRequest request, CancellationToken ct)
        => Ok(await schema.UpdateAsync(request, CurrentUserId(), ct));

    private Guid? CurrentUserId()
    {
        var sub = User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value;
        return Guid.TryParse(sub, out var id) ? id : null;
    }
}
