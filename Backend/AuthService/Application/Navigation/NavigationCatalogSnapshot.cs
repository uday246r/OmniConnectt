namespace AuthService.Application.Navigation;

/// <summary>
/// Everything the tree is built from, flattened and free of EF types so
/// <see cref="NavigationTreeBuilder"/> stays a pure function.
/// </summary>
public sealed record NavigationCatalogSnapshot(
    IReadOnlyList<NavFeature> Features,
    IReadOnlyDictionary<string, IReadOnlyList<NavItemRow>> NavItemsByFeatureKey,
    IReadOnlyDictionary<string, NavRenderMetadata> RenderByFeatureKey);

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
