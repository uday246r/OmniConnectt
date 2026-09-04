using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using Microsoft.EntityFrameworkCore;
// Capability is now a plain string per feature (see PermissionFeatureCapability) — no fixed enum.

namespace AuthService.Infrastructure.Security;

/// <summary>
/// Computes a user's effective permissions server-side: role grants unioned with the user's
/// Grant overrides, minus Revoke overrides, restricted to currently-active permission features
/// (a soft-disabled feature — e.g. a removed remote app — never appears even if old rows reference it).
/// This is the single place that logic lives; both login and refresh call it fresh every time.
/// </summary>
public class PermissionClaimsBuilder(AuthDbContext db)
{
    public async Task<PermissionClaimsResult> BuildAsync(User user, CancellationToken ct = default)
    {
        /*
         * A "No Role" user is NOT the same as "no permissions, full stop" — the Extra Permissions step
         * on the user form explicitly supports granting individual overrides to any user regardless of
         * role, "no role" included (that's precisely how a Maker-Checker approval works: a checker who
         * needs only the Approvals capability and nothing else, with no role to attach it to). This
         * used to early-return `[]` the moment RoleId was null, before UserPermissionOverrides was ever
         * queried — so a roleless user's overrides were computed correctly by ReplacePermissionOverridesAsync,
         * stored correctly, visible correctly in the edit form... and then silently discarded every
         * single time an access token was actually minted. The bug was invisible because almost every
         * account in practice has a role; it surfaced testing a role-less checker granted the Approvals
         * capability directly, whose freshly-minted token still carried zero permissions.
         *
         * Fix: treat "no role" as "zero role grants", not as "skip permissions entirely" — the override
         * loop below still runs and Grant overrides still take effect on top of that empty base.
         */
        Role? role = null;
        if (user.RoleId is not null)
        {
            role = await db.Roles.AsNoTracking().FirstOrDefaultAsync(r => r.Id == user.RoleId, ct);
        }

        if (role is { IsAdministrator: true })
        {
            // Unrestricted — no need to materialize the full grant list, the frontend/backend both
            // treat IsAdministrator as "every capability on every feature, forever".
            return new PermissionClaimsResult(true, []);
        }

        var roleGrantPairs = new List<(string Key, string Capability)>();
        if (role is not null)
        {
            var roleGrants = await db.RolePermissions
                .AsNoTracking()
                .Where(rp => rp.RoleId == role.Id && rp.Feature!.IsActive)
                .Select(rp => new { rp.Feature!.Key, rp.Capability })
                .ToListAsync(ct);
            roleGrantPairs.AddRange(roleGrants.Select(g => (g.Key, g.Capability)));
        }

        var overrides = await db.UserPermissionOverrides
            .AsNoTracking()
            .Where(o => o.UserId == user.Id && o.Feature!.IsActive)
            .Select(o => new { o.Feature!.Key, o.Capability, o.Effect })
            .ToListAsync(ct);

        var effective = new HashSet<(string Key, string Capability)>(roleGrantPairs);

        foreach (var o in overrides)
        {
            var entry = (o.Key, o.Capability);
            if (o.Effect == PermissionEffect.Grant)
            {
                effective.Add(entry);
            }
            else
            {
                effective.Remove(entry);
            }
        }

        /*
         * Only capabilities that still exist, are still active, and are still API-enforced reach the
         * token. Two separate reasons, both load-bearing.
         *
         * EXISTENCE. A grant is a (FeatureId, Capability-string) pair with no foreign key onto the
         * capability row, and the query above filters on Feature.IsActive alone. So when a remote
         * stopped declaring one capability of a module it still owned, the grant survived and kept
         * minting into every affected user's token — a permission no attribute required any more, held
         * by people nobody had granted it to since. Joining the live capability set is what ends that.
         *
         * TYPE. Only Api capabilities belong in the claim: those are the ones the four authorization
         * filters read from it. Everything else — KPIs, charts, exports, bulk actions — is delivered
         * through the cached per-user set instead, which is what stops the token growing without
         * bound as remotes declare hundreds of them. This filter is the single point where that
         * invariant is enforced, and a test asserts it.
         */
        var deliverable = await db.PermissionFeatureCapabilities
            .AsNoTracking()
            .Where(c => c.IsActive && c.Type == CapabilityType.Api && c.Feature!.IsActive)
            .Select(c => new { FeatureKey = c.Feature!.Key, CapabilityKey = c.Key })
            .ToListAsync(ct);

        // A lookup rather than a pairwise comparison, so this stays one pass over the user's grants
        // however large the catalog grows.
        var apiCapabilities = new HashSet<string>(
            deliverable.Select(c => $"{c.FeatureKey}:{c.CapabilityKey}"),
            StringComparer.OrdinalIgnoreCase);

        var permissions = effective
            .Select(e => $"{e.Key}:{e.Capability}")
            .Where(p => apiCapabilities.Contains(p))
            .OrderBy(s => s, StringComparer.Ordinal)
            .ToList();

        return new PermissionClaimsResult(false, permissions);
    }
}
