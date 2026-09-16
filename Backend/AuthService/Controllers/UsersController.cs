using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Infrastructure.Security;
using AuthService.Infrastructure.Seed;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AuthService.Controllers;

[ApiController]
[Route("api/users")]
[Authorize]
public class UsersController(UserAppService users) : ControllerBase
{
    private const string Feature = AuthDbSeeder.HostFeatureKeys.SettingsUsers;

    [HttpGet]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<PagedResult<UserListItemDto>>> List(
        [FromQuery] UserListFilter filter, [FromQuery] int page = 1, [FromQuery] int pageSize = 25,
        CancellationToken ct = default)
        => Ok(await users.ListAsync(Math.Max(page, 1), Math.Clamp(pageSize, 1, 100), filter, ct));

    /// <summary>The whole directory's counts for the cards above the Users table.</summary>
    [HttpGet("summary")]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<UserDirectorySummaryDto>> Summary(CancellationToken ct)
        => Ok(await users.SummaryAsync(ct));

    /// <summary>The Role filter's options, from the directory itself under the other filters applied.</summary>
    [HttpGet("facets")]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<UserListFacetsDto>> Facets([FromQuery] UserListFilter filter, CancellationToken ct)
        => Ok(await users.FacetsAsync(filter, ct));

    [HttpGet("{id:guid}")]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<UserDetailDto>> Get(Guid id, CancellationToken ct)
        => Ok(await users.GetAsync(id, ct));

    [HttpPost]
    [RequirePermission(Feature, "Create")]
    public async Task<IActionResult> Create([FromBody] CreateUserWithOverridesRequest request, CancellationToken ct)
    {
        var result = await users.CreateAsync(request.User, request.Overrides, CurrentUserId(), ct, bypassApproval: IsSuperAdmin());
        if (result.Applied is not null)
        {
            return CreatedAtAction(nameof(Get), new { id = result.Applied.User.Id }, result.Applied);
        }
        // Gated: nothing was created. 202 Accepted — the request is understood and queued, not applied.
        return Accepted(result.Pending);
    }

    [HttpPut("{id:guid}")]
    [RequirePermission(Feature, "Edit")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateUserWithOverridesRequest request, CancellationToken ct)
    {
        var result = await users.UpdateAsync(id, request.User, request.Overrides, CurrentUserId(), ct, bypassApproval: IsSuperAdmin());
        return result.Applied is not null ? Ok(result.Applied) : Accepted(result.Pending);
    }

    [HttpPatch("{id:guid}/status")]
    [RequirePermission(Feature, "Disable")]
    public async Task<IActionResult> UpdateStatus(Guid id, [FromBody] UpdateUserStatusRequest request, CancellationToken ct)
    {
        var result = await users.UpdateStatusAsync(id, request.IsActive, CurrentUserId(), ct, bypassApproval: IsSuperAdmin());
        return result.Applied is not null ? Ok(result.Applied) : Accepted(result.Pending);
    }

    [HttpDelete("{id:guid}")]
    [RequirePermission(Feature, "Delete")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var pending = await users.DeleteAsync(id, CurrentUserId(), ct, bypassApproval: IsSuperAdmin());
        return pending is null ? NoContent() : Accepted(pending);
    }

    [HttpGet("{id:guid}/permission-overrides")]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<IReadOnlyList<PermissionOverrideDto>>> GetOverrides(Guid id, CancellationToken ct)
        => Ok(await users.GetPermissionOverridesAsync(id, ct));

    [HttpPut("{id:guid}/permission-overrides")]
    [RequirePermission(Feature, "Edit")]
    public async Task<IActionResult> ReplaceOverrides(
        Guid id, [FromBody] UpdateUserPermissionOverridesRequest request, CancellationToken ct)
    {
        var result = await users.ReplacePermissionOverridesAsync(id, request.Overrides, CurrentUserId(), ct, bypassApproval: IsSuperAdmin());
        return result.Applied is not null ? Ok(result.Applied) : Accepted(result.Pending);
    }

    private Guid? CurrentUserId()
    {
        var sub = User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value;
        return Guid.TryParse(sub, out var id) ? id : null;
    }

    /// <summary>
    /// Super Admin bypass predicate for the Maker-Checker gate. Deliberately the strict single-claim
    /// check — the exact claim AuthService issues — not a wider admin test, so the population that
    /// skips assignment is identical across every service that has one of these helpers.
    /// </summary>
    private bool IsSuperAdmin() => User.FindFirst(JwtTokenService.AdministratorClaimType)?.Value == "true";
}
