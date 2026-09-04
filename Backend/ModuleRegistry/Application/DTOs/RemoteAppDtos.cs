using System.ComponentModel.DataAnnotations;
namespace ModuleRegistry.Application.DTOs;

public record PagedResult<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize);

public record CapabilityDto(string Key, string DisplayName);

public record RemoteAppDto(
    Guid Id,
    string Key,
    string DisplayName,
    string? IconKey,
    string ManifestUrl,
    int SidebarOrder,
    string Status,
    string? MaintenanceMessage,
    string PermissionFeatureKey,
    string? PermissionsSourceUrl,
    IReadOnlyList<CapabilityDto> Capabilities,
    string Health,
    DateTimeOffset? LastHealthCheckAt,
    string? LastHealthError,
    string? ContainerName,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

/*
 * Validation as data annotations so [ApiController] answers a bad request with a 400 and a per-field
 * error list before any service runs. Lengths match ModuleRegistryDbContext exactly, so a value the
 * API accepts is always one the schema can store.
 *
 * The Key pattern is the important one: RemoteApp.Key becomes the Module Federation container name and
 * the root of every permission feature key for the app (remote.<key>, remote.<key>.<module>:<cap>).
 * A key containing a dot, a colon or an uppercase letter would silently corrupt that namespace — a key
 * of "a.b" would produce feature keys indistinguishable from a sub-module of "a" — so it is restricted
 * to lowercase letters, digits and hyphens, and must start with a letter.
 */
public record CreateRemoteAppRequest(
    [Required(AllowEmptyStrings = false, ErrorMessage = "Application key is required.")]
    [MaxLength(100, ErrorMessage = "Application key cannot exceed 100 characters.")]
    [RegularExpression("^[a-z][a-z0-9-]*$", ErrorMessage = "Application key must start with a lowercase letter and contain only lowercase letters, digits and hyphens.")]
    string Key,

    [Required(AllowEmptyStrings = false, ErrorMessage = "Display name is required.")]
    [MaxLength(200, ErrorMessage = "Display name cannot exceed 200 characters.")]
    string DisplayName,

    [MaxLength(100, ErrorMessage = "Icon key cannot exceed 100 characters.")]
    string? IconKey,

    [Required(AllowEmptyStrings = false, ErrorMessage = "Manifest URL is required.")]
    [MaxLength(2048, ErrorMessage = "Manifest URL cannot exceed 2048 characters.")]
    [Url(ErrorMessage = "Manifest URL must be a full absolute URL, e.g. http://localhost:5001/mf-manifest.json")]
    string ManifestUrl,

    [MaxLength(2048, ErrorMessage = "Permissions source URL cannot exceed 2048 characters.")]
    [Url(ErrorMessage = "Permissions source URL must be a full absolute URL.")]
    string? PermissionsSourceUrl = null,

    // Bounded so the sidebar cannot be handed an int that overflows a client-side sort or renders as
    // a nonsense position. 1-based: position 1 is the top of the Apps list, which is what the field
    // says it does. Negatives and 0 used to be accepted (as an undocumented "pin to top" trick) and
    // only ever produced positions an admin could not reason about against a 1-based list.
    [Range(1, 100000, ErrorMessage = "Display order must be 1 or higher.")]
    int SidebarOrder = 100);

public record UpdateRemoteAppRequest(
    [Required(AllowEmptyStrings = false, ErrorMessage = "Display name is required.")]
    [MaxLength(200, ErrorMessage = "Display name cannot exceed 200 characters.")]
    string DisplayName,

    [MaxLength(100, ErrorMessage = "Icon key cannot exceed 100 characters.")]
    string? IconKey,

    [Required(AllowEmptyStrings = false, ErrorMessage = "Manifest URL is required.")]
    [MaxLength(2048, ErrorMessage = "Manifest URL cannot exceed 2048 characters.")]
    [Url(ErrorMessage = "Manifest URL must be a full absolute URL.")]
    string ManifestUrl,

    [MaxLength(2048, ErrorMessage = "Permissions source URL cannot exceed 2048 characters.")]
    [Url(ErrorMessage = "Permissions source URL must be a full absolute URL.")]
    string? PermissionsSourceUrl,

    [Range(1, 100000, ErrorMessage = "Display order must be 1 or higher.")]
    int SidebarOrder);

public record UpdateRemoteAppStatusRequest(
    [Required(AllowEmptyStrings = false, ErrorMessage = "Status is required.")]
    [MaxLength(20)]
    string Status,

    [MaxLength(2000, ErrorMessage = "Maintenance message cannot exceed 2000 characters.")]
    string? MaintenanceMessage);

/// <summary>What the host's sidebar actually consumes — deliberately narrower than the admin DTO (no PermissionFeatureKey, timestamps, etc.).</summary>
public record SidebarAppDto(
    string Key,
    string DisplayName,
    string? IconKey,
    string ManifestUrl,
    int SidebarOrder,
    string Status,
    string? MaintenanceMessage,
    string Health,
    DateTimeOffset? LastHealthCheckAt);

/// <summary>
/// One entry in the platform health panel. Covers registered remote apps today; the shape is
/// deliberately generic so backend services can be folded in without a DTO change.
/// </summary>
public record HealthEntryDto(string Key, string DisplayName, string Health, DateTimeOffset? LastCheckedAt, string? Error);
