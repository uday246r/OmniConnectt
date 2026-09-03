namespace ModuleRegistry.Domain.Entities;

/// <summary>
/// The last-known capability set fetched from a RemoteApp's PermissionsSourceUrl (or, if that's
/// unset, nothing — the app simply has no dynamically-declared capabilities beyond sidebar
/// visibility). Mirrors AuthDb's PermissionFeatureCapability — this is the local cache ModuleRegistry
/// pushes from; AuthService is still the actual source of truth the host reads at login.
/// </summary>
public class RemoteAppCapability
{
    public Guid Id { get; set; }

    public Guid RemoteAppId { get; set; }
    public RemoteApp? RemoteApp { get; set; }

    /// <summary>
    /// Sub-module this capability belongs to, e.g. "department". Empty string for a remote that
    /// still reports the old flat contract, which is treated as one implicit module.
    /// </summary>
    public string ModuleKey { get; set; } = string.Empty;

    /// <summary>Human label for the sub-module, e.g. "Department". Stored because no other hop carries it.</summary>
    public string ModuleDisplayName { get; set; } = string.Empty;

    public required string Key { get; set; }
    public required string DisplayName { get; set; }

    /// <summary>What granting it lets someone do. Null for capabilities a remote discovered by reflection, which have no prose to offer.</summary>
    public string? Description { get; set; }

    /// <summary>
    /// Mirrors PermissionFeatureCapability.Type, stored as a string rather than an enum because this
    /// service does not interpret the value — it only relays it, and inventing an enum here would
    /// mean a remote declaring a type this service has not been rebuilt for gets it dropped in
    /// transit rather than passed on to AuthService, which does know what to do with an unknown one.
    /// </summary>
    public string Type { get; set; } = "Api";

    public int SortOrder { get; set; }
}
