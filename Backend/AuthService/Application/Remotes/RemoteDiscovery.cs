namespace AuthService.Application.Remotes;

/// <summary>
/// One capability a remote app declares, flattened with its owning sub-module.
/// <para>
/// Kept flat rather than nested because it maps 1:1 onto a <c>RemoteAppCapability</c> row, and the
/// nesting is only needed at the two ends — reading the remote's discovery endpoint and pushing to
/// AuthService — where it is grouped back up.
/// </para>
/// <para>
/// <see cref="ModuleKey"/> is empty for a remote still using the original flat contract, meaning the
/// capability belongs directly to the app rather than to a sub-module.
/// </para>
/// </summary>
/// <param name="Type">
/// What the capability guards, which decides how AuthService delivers it: "Api" capabilities are
/// carried in the JWT for the authorization filters to read, everything else is fetched separately.
/// Defaults to "Api" because every remote that predates the capability manifest declares only
/// endpoint guards, and that is exactly what they have always meant.
/// </param>
/// <param name="GroupKey">
/// Not carried across the wire. AuthService derives it from the key's dotted prefix, so there is one
/// place that decides what grouping means rather than three hops that could disagree.
/// </param>
public record RemoteCapability(
    string ModuleKey,
    string ModuleDisplayName,
    string Key,
    string DisplayName,
    string? Description = null,
    string Type = "Api");

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
