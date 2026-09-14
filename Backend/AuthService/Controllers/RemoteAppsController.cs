using System.IdentityModel.Tokens.Jwt;
using System.Text.Json;
using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Infrastructure.Remotes;
using AuthService.Infrastructure.Security;
using AuthService.Infrastructure.Seed;
using AuthService.Options;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace AuthService.Controllers;

/// <summary>
/// Setup &gt; Applications: the admin surface for registering remote micro-frontends, plus the health
/// feed the host shell polls.
/// </summary>
/// <remarks>
/// <para>
/// Absorbed from the retired Module Registry service. Moving it here closed a real hole for free:
/// <c>MustChangePasswordFilter</c> is registered globally in this service, and the registry had no
/// equivalent — so a user holding a temporary password could reach every write endpoint on the
/// registry's port while being locked out of everything on AuthService's.
/// </para>
/// <para>
/// The sidebar itself is NOT served from here. It comes from <c>GET /api/navigation</c>, which builds
/// the whole tree — host rows and remote apps together — from the caller's permissions in one read.
/// A second endpoint returning a parallel list of apps was a duplicate source of truth for the same
/// question, and is gone.
/// </para>
/// </remarks>
[ApiController]
[Route("api/remote-apps")]
[Authorize]
public class RemoteAppsController(
    RemoteAppAppService remoteApps,
    RemoteHealthProber healthProber,
    IOptions<RemoteHealthOptions> remoteHealthOptions) : ControllerBase
{
    private const string Feature = AuthDbSeeder.HostFeatureKeys.SettingsApplications;

    [HttpGet]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<PagedResult<RemoteAppDto>>> List(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 25, [FromQuery] string? search = null,
        CancellationToken ct = default)
        => Ok(await remoteApps.ListAsync(Math.Max(page, 1), Math.Clamp(pageSize, 1, 100), search, ct));

    [HttpGet("{id:guid}")]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<RemoteAppDto>> Get(Guid id, CancellationToken ct)
        => Ok(await remoteApps.GetAsync(id, ct));

    [HttpPost]
    [RequirePermission(Feature, "Register")]
    public async Task<IActionResult> Create([FromBody] CreateRemoteAppRequest request, CancellationToken ct)
    {
        var result = await remoteApps.CreateAsync(request, CurrentUserId(), CurrentUserName(), ct, bypassApproval: IsSuperAdmin());
        if (result.Applied is not null)
        {
            return CreatedAtAction(nameof(Get), new { id = result.Applied.Id }, result.Applied);
        }

        // Gated: nothing was registered. 202 Accepted — the request is understood and queued, not applied.
        return Accepted(result.Pending);
    }

    [HttpPut("{id:guid}")]
    [RequirePermission(Feature, "Edit")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateRemoteAppRequest request, CancellationToken ct)
    {
        var result = await remoteApps.UpdateAsync(id, request, CurrentUserId(), CurrentUserName(), ct, bypassApproval: IsSuperAdmin());
        return result.Applied is not null ? Ok(result.Applied) : Accepted(result.Pending);
    }

    [HttpPatch("{id:guid}/status")]
    [RequirePermission(Feature, "Disable")]
    public async Task<IActionResult> UpdateStatus(Guid id, [FromBody] UpdateRemoteAppStatusRequest request, CancellationToken ct)
    {
        var result = await remoteApps.UpdateStatusAsync(
            id, request.Status, request.MaintenanceMessage, CurrentUserId(), CurrentUserName(), ct,
            bypassApproval: IsSuperAdmin());
        return result.Applied is not null ? Ok(result.Applied) : Accepted(result.Pending);
    }

    [HttpDelete("{id:guid}")]
    [RequirePermission(Feature, "Delete")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var pending = await remoteApps.DeleteAsync(id, CurrentUserId(), CurrentUserName(), ct, bypassApproval: IsSuperAdmin());
        return pending is null ? NoContent() : Accepted(pending);
    }

    [HttpPost("resync-permissions")]
    [RequirePermission(Feature, "Edit")]
    public async Task<IActionResult> ResyncPermissions(CancellationToken ct)
    {
        var count = await remoteApps.ResyncPermissionsAsync(CurrentUserId(), CurrentUserName(), ct);
        return Ok(new { resyncedCount = count });
    }

    /// <summary>
    /// Real reachability of each registered app, for the host dashboard's system-health panel and the
    /// sidebar's "not responding" badge.
    /// </summary>
    /// <remarks>
    /// No capability attribute on purpose. It is filtered server-side to apps the caller's token
    /// grants something on — the same two-prefix rule the sidebar uses — so it reveals nothing the
    /// sidebar does not, and requiring <c>host.settings.applications:View</c> would make the health
    /// badge an administrator-only feature.
    /// </remarks>
    [HttpGet("health")]
    public async Task<ActionResult<IReadOnlyList<HealthEntryDto>>> Health(CancellationToken ct)
    {
        var (isAdministrator, permissions) = CallerAccess();
        return Ok(await remoteApps.GetHealthAsync(isAdministrator, permissions, ct));
    }

    /// <summary>
    /// Re-probes the remotes now, then returns the fresh result.
    ///
    /// <see cref="Health"/> reads the stored value written by the background sweep, so before this
    /// existed there was no way for the UI to ask "check again" — refreshing the page just re-read
    /// the same row, which is exactly why a stale "Degraded" appeared unfixable to the user.
    ///
    /// Throttled by <see cref="RemoteHealthOptions.OnDemandMaximumAge"/>: if a sweep ran moments ago
    /// this returns the current values without probing, so repeated refreshes cannot become a probe
    /// storm against the remotes. Same visibility rule as <see cref="Health"/>, and it deliberately
    /// requires no special permission — it reveals nothing the caller cannot already see, and the
    /// throttle is what protects it rather than authorization.
    /// </summary>
    [HttpPost("health/refresh")]
    public async Task<ActionResult<IReadOnlyList<HealthEntryDto>>> RefreshHealth(CancellationToken ct)
    {
        await healthProber.ProbeIfStaleAsync(remoteHealthOptions.Value.OnDemandMaximumAge, ct);

        var (isAdministrator, permissions) = CallerAccess();
        return Ok(await remoteApps.GetHealthAsync(isAdministrator, permissions, ct));
    }

    private (bool IsAdministrator, IReadOnlySet<string> Permissions) CallerAccess()
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
            // Fail closed, matching RequirePermissionAttribute: an unreadable claim grants nothing
            // rather than throwing a 500 that says more about the token than a caller should learn.
            permissions = [];
        }

        return (isAdministrator, permissions);
    }

    private bool IsSuperAdmin() => User.FindFirst(JwtTokenService.AdministratorClaimType)?.Value == "true";

    private Guid? CurrentUserId()
    {
        var sub = User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
        return Guid.TryParse(sub, out var id) ? id : null;
    }

    private string? CurrentUserName() => User.FindFirst(JwtRegisteredClaimNames.Name)?.Value;
}
