using System.ComponentModel.DataAnnotations;

namespace AuthService.Application.DTOs;

/// <summary>
/// A registered remote app as the Setup &gt; Applications screen sees it.
/// </summary>
/// <param name="Id">
/// The permission feature's id, which is also the registration's primary key. There is no separate
/// surrogate: one feature, one app.
/// </param>
/// <param name="DisplayName">
/// Read from the permission feature, not from a second copy on the registration — see
/// <see cref="Domain.Entities.RemoteApp"/> for why holding two was a bug factory.
/// </param>
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
    string Health,
    DateTimeOffset? LastHealthCheckAt,
    string? LastHealthError,
    string? ContainerName,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

/*
 * Validation as data annotations so [ApiController] answers a bad request with a 400 and a per-field
 * error list before any service runs. Lengths match AuthDbContext exactly, so a value the API accepts
 * is always one the schema can store.
 *
 * The Key pattern is the important one: RemoteApp.Key becomes the /apps/{key} route segment and the
 * root of every permission feature key for the app (remote.<key>, remote.<key>.<module>:<cap>). A key
 * containing a dot, a colon or an uppercase letter would silently corrupt that namespace — a key of
 * "a.b" would produce feature keys indistinguishable from a sub-module of "a" — so it is restricted
 * to lowercase letters, digits and hyphens, and must start with a letter. The service applies the
 * identical pattern, so a caller that bypasses model binding gets the same answer and the same words.
 */
public record CreateRemoteAppRequest(
    [Required(AllowEmptyStrings = false, ErrorMessage = "Application key is required.")]
    [MaxLength(100, ErrorMessage = "Application key cannot exceed 100 characters.")]
    [RegularExpression("^[a-z][a-z0-9-]{1,49}$", ErrorMessage = "Application key must be 2-50 characters, start with a lowercase letter, and contain only lowercase letters, digits and hyphens.")]
    string Key,

    [Required(AllowEmptyStrings = false, ErrorMessage = "Display name is required.")]
    [MaxLength(200, ErrorMessage = "Display name cannot exceed 200 characters.")]
    string DisplayName,

    [MaxLength(100, ErrorMessage = "Icon key cannot exceed 100 characters.")]
    string? IconKey,

    [Required(AllowEmptyStrings = false, ErrorMessage = "Manifest URL is required.")]
    [MaxLength(2048, ErrorMessage = "Manifest URL cannot exceed 2048 characters.")]
    // Shape is checked by ManifestUrlPolicy, which needs the app key: /modules/<key>/<version>/mf-manifest.json.
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
    // Shape is checked by ManifestUrlPolicy, which needs the app key: /modules/<key>/<version>/mf-manifest.json.
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

/// <summary>
/// One entry in the platform health panel, and the only remote-app feed the host shell consumes
/// besides the navigation tree.
/// </summary>
/// <remarks>
/// It carries <paramref name="DisplayName"/> as well as <paramref name="Key"/> because the host also
/// uses this to label permission strings on the profile and user-detail screens. That used to be a
/// second endpoint returning a near-duplicate of the sidebar; one feed with both fields replaced it.
/// </remarks>
public record HealthEntryDto(
    string Key,
    string DisplayName,
    string Health,
    DateTimeOffset? LastCheckedAt,
    string? Error);

/// <summary>
/// The one flat shape both sides of a remote-app approval diff are built from — same discipline as
/// <see cref="UserSnapshotDto"/>.
/// </summary>
/// <remarks>
/// <para>
/// Status and MaintenanceMessage ride along even on a plain Update, where they are unchanged on both
/// sides, so a single shape covers all five actions and the Approval Centre's diff pane never has to
/// know which action it is rendering.
/// </para>
/// <para>
/// This replaces serialising the raw request DTO on one side and an anonymous object on the other,
/// which agreed only by coincidence: add a field to <see cref="UpdateRemoteAppRequest"/> and the diff
/// silently reported it as changed-from-nothing on every request. Delete was worse — it stored
/// <c>{}</c>, so a checker approving a deletion was shown nothing at all about what they were
/// deleting.
/// </para>
/// <para>
/// Health is deliberately absent: it is rewritten on a probe interval, so diffing it would report a
/// change nobody requested.
/// </para>
/// </remarks>
public record RemoteAppSnapshotDto(
    string Key,
    string DisplayName,
    string? IconKey,
    string ManifestUrl,
    string? PermissionsSourceUrl,
    int SidebarOrder,
    string Status,
    string? MaintenanceMessage);
