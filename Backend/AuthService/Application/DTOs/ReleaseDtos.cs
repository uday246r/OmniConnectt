using System.ComponentModel.DataAnnotations;

namespace AuthService.Application.DTOs;

/// <summary>
/// A published build the release pipeline tells AuthService about. For a remote, its folder must
/// already be on the web server at <c>/modules/&lt;key&gt;/&lt;version&gt;/</c>; for the host
/// (<c>key = "host"</c>), <paramref name="BridgeVersion"/> is required. The display fields are used only
/// when the app does not exist yet (a fresh installation).
/// </summary>
public record RegisterReleaseRequest(
    [Required, RegularExpression("^[a-z][a-z0-9-]{1,49}$", ErrorMessage = "Key must be an application key, or 'host'.")]
    string Key,

    [Required, RegularExpression(@"^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$", ErrorMessage = "Version must be a plain version folder name such as 4.7.3.")]
    string Version,

    [MaxLength(128)] string? Checksum = null,
    [MaxLength(100)] string? ReleaseId = null,
    [MaxLength(32)] string? BridgeVersion = null,
    [MaxLength(200)] string? DisplayName = null,
    [MaxLength(100)] string? IconKey = null,
    [MaxLength(2048)] string? PermissionsSourceUrl = null,
    [Range(1, 100000)] int? SidebarOrder = null);

public record PromoteReleaseRequest(
    [Required, RegularExpression("^[a-z][a-z0-9-]{1,49}$")] string Key,
    [Required, RegularExpression(@"^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$")] string Version);

public record RollbackReleaseRequest(
    [Required, RegularExpression("^[a-z][a-z0-9-]{1,49}$")] string Key);

public record ReleaseRecordDto(
    string Key,
    string Version,
    string Status,
    string? ManifestUrl,
    string? ContainerName,
    string? RequiredHostBridge,
    string? BridgeVersion,
    string? Checksum,
    string? ReleaseId,
    DateTimeOffset RegisteredAt,
    DateTimeOffset? PromotedAt,
    string? PromotedBy);
