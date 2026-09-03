namespace ModuleRegistry.Domain;

/// <summary>
/// One row a remote app contributes to the host sidebar, flattened with the module it belongs to.
/// <para>
/// Not one-to-one with a module: "View Leads" and "Create Lead" are both the Lead module, differing
/// only in <see cref="RequiredCapability"/>. Modelling nav as a list under a module rather than a
/// property of one is what keeps both rows.
/// </para>
/// </summary>
/// <param name="RequiredCapability">Null means any capability on the module is enough to see the row.</param>
public record RemoteNavItem(
    string ModuleKey,
    string Key,
    string Label,
    string? IconKey,
    string RouteSegment,
    int SortOrder,
    string? RequiredCapability);

/// <summary>
/// What a remote's discovery endpoint reports: its permission surface, and the sidebar it contributes.
/// </summary>
/// <param name="Nav">
/// Null when the remote did not report navigation at all (the v1 flat contract). That is
/// deliberately distinct from an empty list: null means "leave whatever AuthService already has
/// alone", empty means "this app has no sidebar rows". Without that distinction a remote being
/// briefly unreachable, or an older remote being resynced, would wipe a working sidebar.
/// </param>
public record RemoteDiscovery(
    IReadOnlyList<RemoteCapability> Capabilities,
    IReadOnlyList<RemoteNavItem>? Nav);

/// <summary>
/// The presentation fields the host needs to render and mount a remote app, replicated into AuthDb so
/// the navigation tree can be served from a single database.
/// <para>
/// Health is deliberately absent. It is rewritten on an interval by the health probe, so a replicated
/// copy would be stale by design and a cached navigation tree would serve the wrong status — the very
/// bug the probe exists to avoid. The host overlays health from its own endpoint instead.
/// </para>
/// </summary>
public record RemoteAppRenderMetadata(
    string? IconKey,
    string ManifestUrl,
    string? ContainerName,
    string Status,
    string? MaintenanceMessage);
