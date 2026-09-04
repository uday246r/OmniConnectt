using AuthService.Domain.Enums;

namespace AuthService.Domain.Entities;

/// <summary>
/// One row per grantable "feature" in the permission matrix (e.g. "host.settings.users",
/// "remote.whatsapp-console"). Host features are seeded at startup; RemoteApp features are
/// upserted by the Module Registry service's internal client whenever an admin registers,
/// edits, or removes a remote app — this table is the single source of truth the Role editor
/// (Features/Capabilities matrix) and the JWT permission claims are both built from.
/// </summary>
public class PermissionFeature
{
    public Guid Id { get; set; }
    public required string Key { get; set; }
    public required string DisplayName { get; set; }
    public PermissionFeatureSource Source { get; set; }

    /// <summary>Soft-disable flag. Set false instead of deleting when a remote app is removed, so historical RolePermission/UserPermissionOverride rows never dangle.</summary>
    public bool IsActive { get; set; } = true;

    public int SortOrder { get; set; }

    /// <summary>
    /// Set when this feature is a SUB-MODULE of another (e.g. "remote.employee.department" under
    /// "remote.employee"). Null for top-level modules.
    /// <para>
    /// Making sub-modules first-class features — rather than encoding them into the capability
    /// string as "Department.Edit" — is what keeps everything else untouched: the JWT stays
    /// "&lt;featureKey&gt;:&lt;capability&gt;", RolePermission and UserPermissionOverride are unchanged, and
    /// both enforcement attributes keep doing a plain string match. It also gives each sub-module a
    /// real DisplayName, which a composite capability key has nowhere to store (every DTO hop is a
    /// bare Key/DisplayName pair).
    /// </para>
    /// </summary>
    public Guid? ParentFeatureId { get; set; }

    public PermissionFeature? ParentFeature { get; set; }

    /// <summary>Sub-modules of this feature. Empty for a leaf or for a feature with no sub-modules.</summary>
    public ICollection<PermissionFeature> Children { get; set; } = new List<PermissionFeature>();

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public ICollection<RolePermission> RolePermissions { get; set; } = new List<RolePermission>();
    public ICollection<UserPermissionOverride> UserPermissionOverrides { get; set; } = new List<UserPermissionOverride>();

    /// <summary>
    /// The set of capabilities THIS feature actually grants — dynamic per feature, not a fixed
    /// global list. Host features declare their own small fixed set at seed time; RemoteApp
    /// features get theirs from whatever the remote's own discovery endpoint reports (see
    /// ModuleRegistry's PermissionsSourceUrl), so a remote adding a new action just shows up here
    /// next sync, nothing hardcoded on this side.
    /// </summary>
    public ICollection<PermissionFeatureCapability> Capabilities { get; set; } = new List<PermissionFeatureCapability>();
}
