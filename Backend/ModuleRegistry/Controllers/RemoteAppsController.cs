using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ModuleRegistry.Application.DTOs;
using ModuleRegistry.Application.Services;
using ModuleRegistry.Infrastructure;
using ModuleRegistry.Infrastructure.Security;
using ModuleRegistry.Options;
using Microsoft.Extensions.Options;

namespace ModuleRegistry.Controllers;

[ApiController]
[Route("api/remote-apps")]
[Authorize]
public class RemoteAppsController(
    RemoteAppAppService remoteApps,
    RemoteHealthProber healthProber,
    IOptions<RemoteHealthOptions> remoteHealthOptions) : ControllerBase
{
    // Must match AuthService.Infrastructure.Seed.AuthDbSeeder.HostFeatureKeys.SettingsApplications —
    // the two services don't share a code package, so this string is kept in sync by hand.
    private const string Feature = "host.settings.applications";

    [HttpGet]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<PagedResult<RemoteAppDto>>> List(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 25, [FromQuery] string? search = null, CancellationToken ct = default)
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
        var result = await remoteApps.UpdateStatusAsync(id, request.Status, request.MaintenanceMessage, CurrentUserId(), CurrentUserName(), ct, bypassApproval: IsSuperAdmin());
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
        var count = await remoteApps.ResyncPermissionsAsync(ct);
        return Ok(new { resyncedCount = count });
    }

    /// <summary>What the host's sidebar actually calls — any authenticated user, filtered server-side to what their token grants.</summary>
    [HttpGet("for-sidebar")]
    public async Task<ActionResult<IReadOnlyList<SidebarAppDto>>> ForSidebar(CancellationToken ct)
    {
        var isAdministrator = User.FindFirst(JwtClaimTypes.Administrator)?.Value == "true";
        var permsClaim = User.FindFirst(JwtClaimTypes.Permissions)?.Value;
        var permissions = string.IsNullOrEmpty(permsClaim)
            ? new HashSet<string>()
            : (JsonSerializer.Deserialize<string[]>(permsClaim) ?? []).ToHashSet();

        return Ok(await remoteApps.GetForSidebarAsync(isAdministrator, permissions, ct));
    }

    /// <summary>
    /// Real reachability of each registered app, for the host dashboard's system-health panel. Same
    /// visibility rule as the sidebar (any authenticated user, filtered to what their token grants),
    /// so this cannot be used to enumerate apps the caller has no access to.
    /// </summary>
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
    /// storm against the remotes. Same visibility rule as the read endpoints, and it deliberately
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
        var isAdministrator = User.FindFirst(JwtClaimTypes.Administrator)?.Value == "true";
        var permsClaim = User.FindFirst(JwtClaimTypes.Permissions)?.Value;
        var permissions = string.IsNullOrEmpty(permsClaim)
            ? new HashSet<string>()
            : (JsonSerializer.Deserialize<string[]>(permsClaim) ?? []).ToHashSet();

        return (isAdministrator, permissions);
    }

    private Guid? CurrentUserId()
    {
        var sub = User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value;
        return Guid.TryParse(sub, out var id) ? id : null;
    }

    private string? CurrentUserName() =>
        User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Name)?.Value;

    /// <summary>
    /// Super Admin bypass predicate for the Maker-Checker gate. Deliberately the strict single-claim
    /// check — the exact claim AuthService issues — not a wider admin test, so the population that
    /// skips assignment is identical across every service that has one of these helpers.
    /// </summary>
    private bool IsSuperAdmin() => User.FindFirst(JwtClaimTypes.Administrator)?.Value == "true";
}
