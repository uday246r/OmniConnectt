using System.IdentityModel.Tokens.Jwt;
using System.Text.Json;
using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Infrastructure.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AuthService.Controllers;

[ApiController]
[Route("api/permissions")]
[Authorize]
public class PermissionsController(
    PermissionCatalogAppService catalog,
    FineCapabilityService fineCapabilities) : ControllerBase
{
    /// <summary>
    /// Every feature the caller is allowed to know about, with its own dynamically-declared
    /// capabilities embedded — the Role editor, the user override editor and the profile screen all
    /// render exactly this, nothing hardcoded.
    /// </summary>
    /// <remarks>
    /// Scoped to the caller rather than gated behind a capability. Gating would break the profile
    /// screen, which every authenticated user reaches and which needs the catalog to render their own
    /// permissions readably; returning everything would let any user enumerate the platform's entire
    /// module inventory, which the sidebar deliberately never reveals. See
    /// <see cref="PermissionCatalogAppService.GetCatalogForCallerAsync"/>.
    /// </remarks>
    [HttpGet("catalog")]
    public async Task<ActionResult<IReadOnlyList<PermissionFeatureDto>>> GetCatalog(
        [FromQuery] bool activeOnly = true, CancellationToken ct = default)
    {
        var isAdministrator = User.FindFirst(JwtTokenService.AdministratorClaimType)?.Value == "true";
        var held = ClaimPermissions();

        // Union with the fine-grained set: a user whose only grant on an app is a KPI card or an
        // export button holds nothing for it in the token, and scoping on the claim alone would hide
        // that app from their own profile.
        if (!isAdministrator && Guid.TryParse(User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value, out var userId))
        {
            held.UnionWith(await fineCapabilities.GetForUserAsync(userId, ct));
        }

        return Ok(await catalog.GetCatalogForCallerAsync(activeOnly, held, isAdministrator, ct));
    }

    private HashSet<string> ClaimPermissions()
    {
        var permsClaim = User.FindFirst(JwtTokenService.PermissionsClaimType)?.Value;

        try
        {
            return string.IsNullOrEmpty(permsClaim)
                ? new HashSet<string>(StringComparer.OrdinalIgnoreCase)
                : (JsonSerializer.Deserialize<string[]>(permsClaim) ?? [])
                    .ToHashSet(StringComparer.OrdinalIgnoreCase);
        }
        catch (JsonException)
        {
            // Fail closed, matching RequirePermissionAttribute and NavigationController: an unreadable
            // claim grants nothing rather than throwing a 500 that says more about the token than a
            // caller should learn.
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        }
    }
}
