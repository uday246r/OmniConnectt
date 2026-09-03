namespace AuthService.Application.DTOs;

/// <summary>
/// One grantable capability as the permission editors see it.
/// </summary>
/// <param name="Type">
/// <see cref="Domain.Enums.CapabilityType"/> as a string. Decides how the editor groups it and, far
/// more importantly, whether it is delivered in the JWT (only "Api" is) or through the cached
/// fine-grained set.
/// </param>
/// <param name="GroupKey">
/// The dotted prefix of <paramref name="Key"/> — "kpi" from "kpi.total-leads" — so the editor can
/// group a long capability list without parsing keys itself. Null when the key has no prefix.
/// </param>
public record CapabilityDto(
    string Key,
    string DisplayName,
    string? Description = null,
    string Type = "Api",
    string? GroupKey = null);

/// <summary>
/// A grantable feature. <paramref name="Children"/> holds its sub-modules — the Role editor renders
/// each as a row of checkboxes under the parent. Empty for features with no sub-modules, including
/// every host feature and any remote still using the flat discovery contract.
/// </summary>
public record PermissionFeatureDto(
    Guid Id,
    string Key,
    string DisplayName,
    string Source,
    int SortOrder,
    IReadOnlyList<CapabilityDto> Capabilities,
    IReadOnlyList<PermissionFeatureDto> Children);

/// <summary>
/// One capability a remote declares for a feature.
/// <para>
/// Everything past <paramref name="SortOrder"/> is optional and defaults to exactly what a capability
/// discovered from a <c>[RequiresCapability]</c> attribute has always been, so a remote that has not
/// adopted the capability manifest sends the same payload it always did and gets the same result.
/// </para>
/// </summary>
public record UpsertCapabilityRequest(
    string Key,
    string DisplayName,
    int SortOrder = 100,
    string? Description = null,
    string Type = "Api",
    string? GroupKey = null);

/// <summary>One sidebar row a module contributes. Many per module — see FeatureNavItem.</summary>
public record UpsertNavItemRequest(
    string Key, string Label, string? IconKey, string RouteSegment, int SortOrder, string? RequiredCapability);

/// <summary>One sub-module of a feature. Becomes a child PermissionFeature keyed "{parentKey}.{Key}".</summary>
/// <param name="Nav">
/// Null and empty mean different things. Null is "the remote said nothing about navigation" — an
/// older remote, or one that could not be reached — and existing rows are kept. Empty is a real
/// answer: the module is grantable but has no sidebar row, and its rows are cleared.
/// </param>
public record UpsertModuleRequest(
    string Key,
    string DisplayName,
    int SortOrder,
    IReadOnlyList<UpsertCapabilityRequest> Capabilities,
    IReadOnlyList<UpsertNavItemRequest>? Nav = null);

public record UpsertPermissionFeatureRequest(
    string Key,
    string DisplayName,
    int SortOrder,
    IReadOnlyList<UpsertCapabilityRequest> Capabilities,
    IReadOnlyList<UpsertModuleRequest>? Modules = null,
    // Remote-app render metadata, replicated so the navigation tree is one database read. All
    // nullable: a host feature has none, and an older Module Registry sends none.
    string? IconKey = null,
    string? ManifestUrl = null,
    string? ContainerName = null,
    string? Status = null,
    string? MaintenanceMessage = null);

public record DeactivatePermissionFeatureRequest(string Key);

public record ResyncPermissionFeaturesRequest(IReadOnlyList<UpsertPermissionFeatureRequest> Features);
