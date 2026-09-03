namespace AuthService.Application.Navigation;

/// <summary>
/// Everything the tree is built from, flattened and free of EF types so
/// <see cref="NavigationTreeBuilder"/> stays a pure function.
/// </summary>
public sealed record NavigationCatalogSnapshot(
    IReadOnlyList<NavFeature> Features,
    IReadOnlyDictionary<string, IReadOnlyList<NavItemRow>> NavItemsByFeatureKey,
    IReadOnlyDictionary<string, NavRenderMetadata> RenderByFeatureKey,
    /// <summary>Sections and host rows, seeded rather than compiled in — see NavSection and HostNavItem.</summary>
    IReadOnlyList<NavSectionRow> Sections,
    IReadOnlyList<HostNavRow> HostItems);

/// <param name="ParentKey">Null for a top-level feature.</param>
public sealed record NavFeature(
    string Key,
    string DisplayName,
    int SortOrder,
    string? ParentKey,
    bool IsActive,
    IReadOnlyList<string> Capabilities);

public sealed record NavItemRow(
    string NavKey,
    string Label,
    string? IconKey,
    string RouteSegment,
    int SortOrder,
    string? RequiredCapability);

public sealed record NavRenderMetadata(
    string? IconKey,
    string ManifestUrl,
    string? ContainerName,
    string Status,
    string? MaintenanceMessage);

public sealed record NavSectionRow(string Key, string Label, int SortOrder, bool PinToBottom);

/// <param name="RequiredFeatureKey">Null means the row is visible to every authenticated user.</param>
public sealed record HostNavRow(
    string Key,
    string Label,
    string? IconKey,
    string RoutePath,
    string SectionKey,
    int SortOrder,
    string? RequiredFeatureKey,
    string? RequiredCapability);
