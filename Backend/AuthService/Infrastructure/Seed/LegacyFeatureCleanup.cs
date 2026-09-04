using Microsoft.EntityFrameworkCore;

namespace AuthService.Infrastructure.Seed;

/// <summary>
/// Removes database rows left behind by features that were built and then withdrawn from scope.
/// <para>
/// Licensing was built and then taken out of scope. The table itself is dropped by a migration, but a
/// database that ran the intervening version also holds a <c>host.settings.licensing</c> permission
/// feature with role grants against it — rows a schema migration will not touch, because they are
/// ordinary permission data that happens to describe a feature no longer in the product.
/// </para>
/// <para>
/// This file is the one place licensing may still be named, for the same reason the historical
/// migration is: its entire job is removing it. The removal guard in the test suite exempts it by
/// name, so a genuine reintroduction anywhere else still fails the build.
/// </para>
/// </summary>
public static class LegacyFeatureCleanup
{
    private const string FeatureKey = "host.settings.licensing";

    /// <summary>
    /// Deletes the feature and everything pointing at it, in an order the foreign keys allow.
    /// <para>
    /// RolePermission has a Restrict relationship onto PermissionFeature, so grants and overrides
    /// must go before the feature itself or the delete fails outright. One existence check gates the
    /// whole thing, so on a database that never had licensing — and on every boot after the first —
    /// this costs a single query that finds nothing.
    /// </para>
    /// </summary>
    public static async Task RunAsync(AuthDbContext db, ILogger logger, CancellationToken ct = default)
    {
        var feature = await db.PermissionFeatures.FirstOrDefaultAsync(f => f.Key == FeatureKey, ct);
        if (feature is null)
        {
            return;
        }

        var grants = await db.RolePermissions.Where(rp => rp.FeatureId == feature.Id).ToListAsync(ct);
        db.RolePermissions.RemoveRange(grants);

        var overrides = await db.UserPermissionOverrides.Where(o => o.FeatureId == feature.Id).ToListAsync(ct);
        db.UserPermissionOverrides.RemoveRange(overrides);

        var capabilities = await db.PermissionFeatureCapabilities.Where(c => c.FeatureId == feature.Id).ToListAsync(ct);
        db.PermissionFeatureCapabilities.RemoveRange(capabilities);

        db.PermissionFeatures.Remove(feature);
        await db.SaveChangesAsync(ct);

        logger.LogInformation(
            "Removed the withdrawn licensing feature, {Grants} role grant(s) and {Overrides} user override(s).",
            grants.Count, overrides.Count);
    }
}
