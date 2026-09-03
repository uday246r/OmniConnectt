using AuthService.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace AuthService.Infrastructure.Seed;

/// <summary>
/// Names, at startup, every permission grant that no longer corresponds to a capability any app still declares.
/// </summary>
/// <remarks>
/// <para>
/// A grant is a (FeatureId, capability-string) pair with no foreign key onto the capability row, so
/// nothing ever stopped a grant outliving the capability it names. Until now that was invisible: the
/// claims builder filtered on the feature being active and never checked the capability at all, so a
/// stale grant kept minting into tokens indefinitely. It now joins the live capability set, which
/// fixes the hole — and silently changes what some existing users can do.
/// </para>
/// <para>
/// This report is that change, made visible. It reads nothing and writes nothing; it only logs which
/// grants are about to stop taking effect and who holds them, so the loss is something an operator
/// sees in the startup log rather than something a user discovers. Run it before deciding whether a
/// stale grant was a mistake worth deleting or a rename worth re-granting.
/// </para>
/// </remarks>
public static class StaleGrantReport
{
    public static async Task RunAsync(AuthDbContext db, ILogger logger, CancellationToken ct = default)
    {
        /*
         * Deliberately NOT filtered by Type, unlike the claims builder.
         *
         * The claims builder answers "does this belong in the token", and a Widget or Export
         * capability correctly answers no — it is delivered through the fine-grained set instead.
         * This report answers a different question: "does the thing this grant names still exist at
         * all". Reusing the builder's filter here would report every business-capability grant on
         * every boot as though it were broken, and a warning that fires for healthy data is a warning
         * nobody reads.
         */
        var live = (await db.PermissionFeatureCapabilities
                .AsNoTracking()
                .Where(c => c.IsActive && c.Feature!.IsActive)
                .Select(c => new { FeatureKey = c.Feature!.Key, CapabilityKey = c.Key })
                .ToListAsync(ct))
            .Select(c => $"{c.FeatureKey}:{c.CapabilityKey}")
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var roleGrants = await db.RolePermissions
            .AsNoTracking()
            .Where(rp => rp.Feature!.IsActive)
            .Select(rp => new { Holder = rp.Role!.Name, Permission = rp.Feature!.Key + ":" + rp.Capability })
            .ToListAsync(ct);

        // Only Grant overrides can lose someone a permission. A Revoke naming a capability that no
        // longer exists is already a no-op and taking it away changes nothing for anybody.
        var userGrants = await db.UserPermissionOverrides
            .AsNoTracking()
            .Where(o => o.Feature!.IsActive && o.Effect == PermissionEffect.Grant)
            .Select(o => new { Holder = o.User!.Email, Permission = o.Feature!.Key + ":" + o.Capability })
            .ToListAsync(ct);

        var stale = roleGrants.Select(g => (Kind: "role", g.Holder, g.Permission))
            .Concat(userGrants.Select(g => (Kind: "user", g.Holder, g.Permission)))
            .Where(g => !live.Contains(g.Permission))
            .ToList();

        if (stale.Count == 0)
        {
            return;
        }

        logger.LogWarning(
            "{Count} permission grant(s) name a capability that is no longer declared by any app. They are kept for audit but no longer take effect.",
            stale.Count);

        foreach (var group in stale.GroupBy(g => g.Permission).OrderBy(g => g.Key, StringComparer.Ordinal))
        {
            logger.LogWarning(
                "  {Permission} — held by {Holders}",
                group.Key,
                string.Join(", ", group.Select(g => $"{g.Kind} '{g.Holder}'")));
        }
    }
}
