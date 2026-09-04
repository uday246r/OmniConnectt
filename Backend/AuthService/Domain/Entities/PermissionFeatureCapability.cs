using AuthService.Domain.Enums;

namespace AuthService.Domain.Entities;

/// <summary>
/// One capability a specific PermissionFeature actually grants (e.g. "Create" on "remote.employee").
/// Replaces a fixed global capability enum applied uniformly to every feature — the Role editor and
/// User override editor render exactly this set per feature, nothing more.
/// </summary>
public class PermissionFeatureCapability
{
    public Guid Id { get; set; }

    public Guid FeatureId { get; set; }
    public PermissionFeature? Feature { get; set; }

    /// <summary>
    /// Stable key used in RolePermission/UserPermissionOverride.Capability and in the JWT's "perms"
    /// claim, e.g. "Create".
    /// <para>
    /// Keys may be dotted — "kpi.total-leads", "chart.leads-over-time" — and that prefix is what gives
    /// the permission editor a third level to group by without needing a third table. The full
    /// identifier stays <c>{featureKey}:{capability}</c> either way, so nothing downstream changes.
    /// </para>
    /// </summary>
    public required string Key { get; set; }

    public required string DisplayName { get; set; }

    /// <summary>What granting this actually lets someone do. Shown in the permission editor, since a key alone rarely explains a business capability.</summary>
    public string? Description { get; set; }

    /// <summary>
    /// What this guards. Decides where the capability is delivered — see <see cref="CapabilityType"/>.
    /// Defaults to <see cref="CapabilityType.Api"/> so every capability that existed before this
    /// column keeps its current behaviour exactly.
    /// </summary>
    public CapabilityType Type { get; set; } = CapabilityType.Api;

    /// <summary>
    /// The dotted prefix of <see cref="Key"/> ("kpi" from "kpi.total-leads"), or null when the key has
    /// no prefix. Derived at sync time and stored so the editor can group without parsing every key on
    /// every render.
    /// </summary>
    public string? GroupKey { get; set; }

    public int SortOrder { get; set; }

    /// <summary>
    /// Soft-delete, matching how <see cref="PermissionFeature.IsActive"/> already behaves.
    /// <para>
    /// Capabilities used to be hard-deleted and recreated on every sync, which is why a capability a
    /// remote stopped declaring left its grants behind: the rows vanished but nothing swept the
    /// RolePermission rows pointing at them, and the claims builder never checked. Deactivating
    /// instead keeps the grant for audit while stopping it from being minted or offered.
    /// </para>
    /// </summary>
    public bool IsActive { get; set; } = true;
}
