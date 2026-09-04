using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace AuthService.Application.Services;

/// <summary>
/// Resolves a user's fine-grained capabilities — the ones deliberately kept out of the JWT.
/// </summary>
/// <remarks>
/// <para>
/// The permission model is one model with two delivery paths. An <see cref="CapabilityType.Api"/>
/// capability guards an endpoint, is read from the token's <c>perms</c> claim by the authorization
/// filters, and is not this class's business. Everything else — KPI cards, charts, exports, panels —
/// is resolved here instead, because a token that carried every one of them would grow past what
/// Kestrel and most proxies will accept once each app declares its own.
/// </para>
/// <para>
/// The grant logic is deliberately identical to <see cref="Infrastructure.Security.PermissionClaimsBuilder"/>:
/// role grants, plus Grant overrides, minus Revoke overrides, restricted to live features and live
/// capabilities. Only the type filter is inverted. Two paths that resolved permissions differently
/// would be a security bug waiting for someone to notice the discrepancy, so if one changes the other
/// has to, and a test asserts they agree.
/// </para>
/// </remarks>
public class FineCapabilityService(AuthDbContext db, IMemoryCache cache)
{
    /// <summary>
    /// Short enough that a revoked capability stops working almost immediately, long enough that a
    /// dashboard rendering a dozen gated widgets does not re-query per widget. Saving a role or a
    /// user's overrides evicts the entry outright, so this is a backstop, not the mechanism.
    /// </summary>
    private static readonly TimeSpan CacheDuration = TimeSpan.FromSeconds(60);

    private const string VersionKey = "fine-capabilities:version";

    /// <summary>
    /// Bumped whenever a change could affect more than one user, and folded into every cache key.
    /// </summary>
    /// <remarks>
    /// Evicting per user is enough for a user's own overrides, and useless for anything else. Editing
    /// a role changes the answer for everyone holding it, and a capability going inactive changes it
    /// for everyone entirely — and neither knows the affected user ids without a query that costs more
    /// than the cache saves. Changing the key prefix instead retires every entry at once; the orphans
    /// are never read again and fall out on their own expiry.
    /// </remarks>
    private long Version => cache.GetOrCreate(VersionKey, _ => 0L);

    private string CacheKey(Guid userId) => $"fine-capabilities:{Version}:{userId}";

    /// <summary>
    /// Every fine-grained permission string the user holds, as <c>{featureKey}:{capability}</c> —
    /// the same format the JWT uses, so a caller merging the two sets needs no translation.
    /// </summary>
    public async Task<IReadOnlyList<string>> GetForUserAsync(Guid userId, CancellationToken ct = default)
    {
        if (cache.TryGetValue(CacheKey(userId), out IReadOnlyList<string>? cached) && cached is not null)
        {
            return cached;
        }

        var resolved = await ResolveAsync(userId, ct);
        cache.Set(CacheKey(userId), resolved, CacheDuration);
        return resolved;
    }

    /// <summary>Drops one user's cached set. For a change that affects only that user's overrides.</summary>
    public void Invalidate(Guid userId) => cache.Remove(CacheKey(userId));

    /// <summary>
    /// Retires every cached set. For a role edit or a catalog sync, which can change the answer for
    /// users this call has no way to enumerate.
    /// </summary>
    public void InvalidateAll() => cache.Set(VersionKey, Version + 1);

    private async Task<IReadOnlyList<string>> ResolveAsync(Guid userId, CancellationToken ct)
    {
        var user = await db.Users
            .AsNoTracking()
            .Where(u => u.Id == userId && !u.IsDeleted)
            .Select(u => new { u.Id, u.RoleId })
            .FirstOrDefaultAsync(ct);

        if (user is null)
        {
            return [];
        }

        /*
         * Everything that is not an Api capability, keyed by the same string the grants use.
         *
         * A dictionary rather than a set, so the value returned is the CATALOG's spelling of the
         * permission and not the grant row's. Capability keys are authored by hand in two places and
         * matched case-insensitively, so a grant can legitimately read "Export.CSV" where the catalog
         * says "export.csv" — and a browser comparing what it was sent against what a component asks
         * for has no catalog to normalise against. Answering in one canonical spelling means the
         * client can match exactly.
         */
        var fine = (await db.PermissionFeatureCapabilities
                .AsNoTracking()
                .Where(c => c.IsActive && c.Type != CapabilityType.Api && c.Feature!.IsActive)
                .Select(c => new { FeatureKey = c.Feature!.Key, CapabilityKey = c.Key })
                .ToListAsync(ct))
            .Select(c => $"{c.FeatureKey}:{c.CapabilityKey}")
            .DistinctBy(s => s, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(s => s, s => s, StringComparer.OrdinalIgnoreCase);

        if (fine.Count == 0)
        {
            return [];
        }

        Role? role = null;
        if (user.RoleId is not null)
        {
            role = await db.Roles.AsNoTracking().FirstOrDefaultAsync(r => r.Id == user.RoleId, ct);
        }

        if (role is { IsAdministrator: true })
        {
            // Consistent with the JWT path, where IsAdministrator means every capability on every
            // active feature. Materialised here rather than signalled, because the browser needs an
            // answer per capability and has no administrator flag of its own to branch on.
            return [.. fine.Values.OrderBy(s => s, StringComparer.Ordinal)];
        }

        var effective = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (role is not null)
        {
            var granted = await db.RolePermissions
                .AsNoTracking()
                .Where(rp => rp.RoleId == role.Id && rp.Feature!.IsActive)
                .Select(rp => rp.Feature!.Key + ":" + rp.Capability)
                .ToListAsync(ct);

            effective.UnionWith(granted);
        }

        var overrides = await db.UserPermissionOverrides
            .AsNoTracking()
            .Where(o => o.UserId == user.Id && o.Feature!.IsActive)
            .Select(o => new { Permission = o.Feature!.Key + ":" + o.Capability, o.Effect })
            .ToListAsync(ct);

        foreach (var o in overrides)
        {
            if (o.Effect == PermissionEffect.Grant)
            {
                effective.Add(o.Permission);
            }
            else
            {
                effective.Remove(o.Permission);
            }
        }

        // Intersected with the live fine-grained set, which does the same two jobs as in the claims
        // builder: it drops a grant whose capability no longer exists, and it keeps Api capabilities
        // out of a set the token already carries.
        return
        [
            .. effective
                .Select(e => fine.TryGetValue(e, out var canonical) ? canonical : null)
                .OfType<string>()
                .OrderBy(s => s, StringComparer.Ordinal)
        ];
    }
}
