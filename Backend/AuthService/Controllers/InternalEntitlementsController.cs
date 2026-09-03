using AuthService.Application.Services;
using AuthService.Infrastructure.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AuthService.Controllers;

/// <summary>
/// The entitlement map, for the other services to cache.
/// <para>
/// AuthService owns licensing because it is the only service that knows about host features — a
/// module registry has no concept of <c>host.system.approvals</c> and so could never license one.
/// Every other service therefore has to be told, and this is the channel: the same shared-API-key
/// arrangement ModuleRegistry already uses to push permission features the other way.
/// </para>
/// <para>
/// Deliberately the whole map rather than a per-feature query. It is a few dozen rows, callers cache
/// it for 30 seconds, and a per-feature endpoint would put an HTTP call on the request path of every
/// gated action in the platform.
/// </para>
/// </summary>
[ApiController]
[Route("internal/entitlements")]
[AllowAnonymous]
[TypeFilter(typeof(InternalApiKeyFilter))]
public class InternalEntitlementsController(EntitlementSnapshotProvider snapshot) : ControllerBase
{
    /// <summary>
    /// Status and Visibility cross the wire as STRINGS, not the enums they are on both sides.
    /// <para>
    /// Neither service configures JsonStringEnumConverter, so enums would serialise as ordinals and
    /// the contract would silently depend on four separate copies of two enums keeping the same
    /// member order forever. Inserting a value in the middle of one of them would re-map every
    /// licence in the platform with nothing failing to announce it. Strings are self-describing:
    /// an unrecognised name is visible, and a reordering is harmless.
    /// </para>
    /// </summary>
    public record EntitlementEntryDto(
        string FeatureKey,
        string Status,
        string Visibility,
        string? PlanTier,
        string? LockReason,
        DateTimeOffset? ExpiresAt);

    public record EntitlementSnapshotDto(DateTimeOffset GeneratedAt, IReadOnlyList<EntitlementEntryDto> Entries);

    [HttpGet]
    public async Task<ActionResult<EntitlementSnapshotDto>> Get(CancellationToken ct)
    {
        var map = await snapshot.GetAsync(ct);

        var entries = map.Values
            .Select(e => new EntitlementEntryDto(
                e.FeatureKey,
                e.Status.ToString(),
                e.Visibility.ToString(),
                e.PlanTier,
                e.LockReason,
                e.ExpiresAt))
            .ToList();

        return Ok(new EntitlementSnapshotDto(DateTimeOffset.UtcNow, entries));
    }
}
