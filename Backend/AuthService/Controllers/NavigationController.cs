using System.Text.Json;
using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Infrastructure.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AuthService.Controllers;

/// <summary>
/// The whole sidebar, already filtered for the caller.
/// <para>
/// The host renders exactly what this returns and holds no navigation structure of its own — no
/// hardcoded submenus, no per-app special cases, no knowledge of what any remote contains. Adding a
/// page to a remote means adding it to that remote's manifest, and it appears here.
/// </para>
/// <para>
/// Permissions are read from the JWT rather than recomputed from the database, deliberately. The
/// enforcement filters read the same claim, so the sidebar is guaranteed to show exactly what the API
/// will allow; recomputing here would produce rows that 403 (and hide rows that would work) for the
/// lifetime of a token, which is a worse failure than the staleness it would remove.
/// </para>
/// </summary>
[ApiController]
[Route("api/navigation")]
[Authorize]
public class NavigationController(NavigationAppService navigation) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<NavigationResponseDto>> Get(CancellationToken ct)
    {
        var isAdministrator = User.FindFirst(JwtTokenService.AdministratorClaimType)?.Value == "true";
        var permsClaim = User.FindFirst(JwtTokenService.PermissionsClaimType)?.Value;

        HashSet<string> permissions;
        try
        {
            permissions = string.IsNullOrEmpty(permsClaim)
                ? []
                : (JsonSerializer.Deserialize<string[]>(permsClaim) ?? []).ToHashSet(StringComparer.OrdinalIgnoreCase);
        }
        catch (JsonException)
        {
            // Fail closed, matching the authorization filters: an unparseable claim means no
            // permissions, so the caller sees an empty sidebar rather than everything.
            permissions = [];
        }

        var tree = await navigation.GetAsync(permissions, isAdministrator, ct);

        // The version hashes the rendered tree, so a 304 is only ever served against the same user's
        // same sidebar. Revalidate rather than blind-cache: licensing can change under a live token.
        var etag = $"\"{tree.Version}\"";
        Response.Headers.ETag = etag;
        Response.Headers.CacheControl = "private, no-cache";

        if (Request.Headers.IfNoneMatch.Any(v => v == etag))
        {
            return StatusCode(StatusCodes.Status304NotModified);
        }

        return Ok(tree);
    }
}
