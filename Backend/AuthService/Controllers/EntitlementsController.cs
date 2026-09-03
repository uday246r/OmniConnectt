using System.Security.Claims;
using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Infrastructure.Security;
using AuthService.Infrastructure.Seed;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AuthService.Controllers;

/// <summary>
/// What this deployment is licensed for, feature by feature.
/// <para>
/// Deliberately separate from the Role editor. Roles answer "who may do this"; entitlement answers
/// "did we buy it". Conflating them would mean revoking a licence by editing every role that
/// referenced it, and would leave no way to author a role against a module the customer has not
/// bought yet.
/// </para>
/// </summary>
[ApiController]
[Route("api/entitlements")]
[Authorize]
public class EntitlementsController(EntitlementAppService entitlements) : ControllerBase
{
    private const string Feature = AuthDbSeeder.HostFeatureKeys.SettingsLicensing;

    /// <summary>The full feature tree with each node's stored and effective licensing state.</summary>
    [HttpGet]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<IReadOnlyList<EntitlementNodeDto>>> GetTree(CancellationToken ct)
        => Ok(await entitlements.GetTreeAsync(ct));

    /// <summary>
    /// Sets one feature's platform-default entitlement. Manage is Super-Admin-only by default —
    /// see the role seed, which grants Admin View but not Manage.
    /// </summary>
    [HttpPut("{featureKey}")]
    [RequirePermission(Feature, "Manage")]
    public async Task<ActionResult<EntitlementNodeDto>> Update(
        string featureKey,
        [FromBody] UpdateEntitlementRequest request,
        CancellationToken ct)
    {
        var actorUserId = Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : (Guid?)null;
        var updated = await entitlements.UpdateAsync(featureKey, request, actorUserId, ct);
        return updated is null ? NotFound() : Ok(updated);
    }
}
