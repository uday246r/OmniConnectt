using AuthService.Application.DTOs;
using AuthService.Application.Entitlements;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace AuthService.Application.Services;

/// <summary>
/// Reads and writes module licensing. Separate from RoleAppService on purpose: this decides what the
/// deployment has bought, not who inside it may use what.
/// </summary>
public class EntitlementAppService(AuthDbContext db, EntitlementSnapshotProvider snapshot)
{
    /// <summary>
    /// The full feature tree with each node's stored and effective entitlement.
    /// <para>Returns every feature, including ones with no row of their own, because the admin needs
    /// to be able to license something that has never been licensed before — listing only existing
    /// rows would make un-licensed-by-omission features unreachable from the UI.</para>
    /// </summary>
    public async Task<IReadOnlyList<EntitlementNodeDto>> GetTreeAsync(CancellationToken ct = default)
    {
        var features = await db.PermissionFeatures
            .AsNoTracking()
            .OrderBy(f => f.SortOrder).ThenBy(f => f.DisplayName)
            .ToListAsync(ct);

        var rows = await db.ModuleEntitlements
            .AsNoTracking()
            .Where(e => e.CompanyId == null)
            .ToListAsync(ct);

        var byFeatureId = rows.ToDictionary(r => r.FeatureId);
        var map = BuildMap(features, rows);
        var now = DateTimeOffset.UtcNow;

        EntitlementNodeDto ToNode(PermissionFeature f) => new(
            f.Key,
            f.DisplayName,
            f.IsActive,
            f.SortOrder,
            byFeatureId.TryGetValue(f.Id, out var own) ? own.Status : EntitlementStatus.Licensed,
            own is not null ? own.Visibility : EntitlementVisibility.Normal,
            own?.PlanTier,
            own?.LockReason,
            own?.ExpiresAt,
            HasOwnEntitlement: own is not null,
            EffectiveOutcome: EntitlementResolver.Outcome(EntitlementResolver.Resolve(f.Key, map, now)).ToString(),
            Children: features
                .Where(c => c.ParentFeatureId == f.Id)
                .Select(ToNode)
                .ToList());

        return features
            .Where(f => f.ParentFeatureId is null)
            .Select(ToNode)
            .ToList();
    }

    /// <summary>
    /// Sets the platform-default entitlement for one feature, creating the row if it has none.
    /// <para>Evicts the in-memory snapshot immediately rather than waiting for its refresh interval,
    /// so an operator who revokes a licence sees it take effect on this node at once. The other
    /// services still converge on their own 30-second poll — bounded and predictable, which is the
    /// trade this design accepts in exchange for never touching the database on the request path.</para>
    /// </summary>
    public async Task<EntitlementNodeDto?> UpdateAsync(
        string featureKey,
        UpdateEntitlementRequest request,
        Guid? actorUserId,
        CancellationToken ct = default)
    {
        var feature = await db.PermissionFeatures.FirstOrDefaultAsync(f => f.Key == featureKey, ct);
        if (feature is null) return null;

        var row = await db.ModuleEntitlements
            .FirstOrDefaultAsync(e => e.FeatureId == feature.Id && e.CompanyId == null, ct);

        var now = DateTimeOffset.UtcNow;
        if (row is null)
        {
            row = new ModuleEntitlement
            {
                Id = Guid.NewGuid(),
                FeatureId = feature.Id,
                CompanyId = null,
                CreatedAt = now,
            };
            db.ModuleEntitlements.Add(row);
        }

        row.Status = request.Status;
        row.Visibility = request.Visibility;
        row.PlanTier = request.PlanTier;
        row.LockReason = request.LockReason;
        row.ExpiresAt = request.ExpiresAt;
        row.UpdatedAt = now;
        row.UpdatedBy = actorUserId;

        await db.SaveChangesAsync(ct);
        snapshot.Invalidate();

        var tree = await GetTreeAsync(ct);
        return Find(tree, featureKey);
    }

    private static EntitlementNodeDto? Find(IReadOnlyList<EntitlementNodeDto> nodes, string key)
    {
        foreach (var node in nodes)
        {
            if (string.Equals(node.FeatureKey, key, StringComparison.OrdinalIgnoreCase)) return node;
            var hit = Find(node.Children, key);
            if (hit is not null) return hit;
        }
        return null;
    }

    /// <summary>Flattens rows into the key-addressed map the resolver walks. Shared with the snapshot provider.</summary>
    internal static Dictionary<string, EntitlementEntry> BuildMap(
        IReadOnlyList<PermissionFeature> features,
        IReadOnlyList<ModuleEntitlement> rows)
    {
        var keyById = features.ToDictionary(f => f.Id, f => f.Key);
        var map = new Dictionary<string, EntitlementEntry>(StringComparer.OrdinalIgnoreCase);

        foreach (var row in rows)
        {
            if (!keyById.TryGetValue(row.FeatureId, out var key)) continue;
            map[key] = new EntitlementEntry(key, row.Status, row.Visibility, row.PlanTier, row.LockReason, row.ExpiresAt);
        }

        return map;
    }
}
