using AuthService.Domain.Enums;

namespace AuthService.Domain.Entities;

/// <summary>
/// A remote micro-frontend registered with the platform: where to fetch it, how to render its row in
/// the sidebar, whether it is currently mounted, and where to discover the capabilities it declares.
/// </summary>
/// <remarks>
/// <para>
/// This replaces the old <c>RemoteAppNavMetadata</c>, which was a REPLICA of a row that lived in a
/// separate ModuleRegistry service and database, kept in step by an HTTP push. That arrangement had a
/// state the sidebar had to defend against on every read — a <see cref="PermissionFeature"/> whose
/// matching metadata row had not arrived, or had arrived and then gone stale. Keyed on
/// <see cref="FeatureId"/> with a cascade from the feature, that state is now unrepresentable.
/// </para>
/// <para>
/// <b>DisplayName and SidebarOrder are deliberately not here.</b> They are
/// <see cref="PermissionFeature.DisplayName"/> and <see cref="PermissionFeature.SortOrder"/>, which
/// is what the navigation tree already orders by. Holding a second copy is precisely what produced
/// the old "a display-order edit must ALSO be pushed for the app it displaced, or the sidebar keeps
/// showing the previous arrangement" class of bug. One copy cannot disagree with itself.
/// </para>
/// </remarks>
public class RemoteApp
{
    /// <summary>
    /// Primary key and foreign key in one: exactly one registration per remote-app
    /// <see cref="PermissionFeature"/>, enforced by the key rather than by a sync that could leave one
    /// side behind.
    /// </summary>
    public Guid FeatureId { get; set; }

    public PermissionFeature? Feature { get; set; }

    /// <summary>
    /// The slug. <c>Feature.Key</c> is always <c>"remote.{Key}"</c>. Also the <c>/apps/{key}</c> URL
    /// segment, the Module Federation runtime registration name, and the root of the approval dedupe
    /// key — so it is immutable after creation.
    /// </summary>
    public required string Key { get; set; }

    public string? IconKey { get; set; }

    /// <summary>Absolute URL of the app's <c>mf-manifest.json</c>.</summary>
    public required string ManifestUrl { get; set; }

    /// <summary>
    /// The Module Federation container name, read from the manifest's own <c>name</c> field by the
    /// probe. Needed to mount the remote, and globally unique in the browser — two apps sharing one
    /// overwrite each other's container at runtime, which is why it carries a unique index.
    /// </summary>
    public string? ContainerName { get; set; }

    public RemoteAppStatus Status { get; set; } = RemoteAppStatus.Active;

    public string? MaintenanceMessage { get; set; }

    /// <summary>
    /// Where this app declares its own capability set (its <c>GET /permissions</c>). Null means the
    /// app declares nothing and its permission feature is managed by hand.
    /// </summary>
    public string? PermissionsSourceUrl { get; set; }

    public RemoteAppHealth Health { get; set; } = RemoteAppHealth.Unknown;

    public DateTimeOffset? LastHealthCheckAt { get; set; }

    public string? LastHealthError { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    public Guid? CreatedBy { get; set; }

    public Guid? UpdatedBy { get; set; }
}
