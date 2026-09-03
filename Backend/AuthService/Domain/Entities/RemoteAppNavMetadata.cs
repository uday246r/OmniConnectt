namespace AuthService.Domain.Entities;

/// <summary>
/// The presentation and mounting fields a remote app needs in the navigation tree, replicated here
/// from the Module Registry.
/// <para>
/// Replication rather than a live call is deliberate. The tree is on the first-paint path of every
/// authenticated page, and joining it against another service would make the sidebar's availability
/// depend on that service being up. Served from AuthDb, sidebar availability equals login
/// availability — and if AuthService is down nobody has a token anyway. A Module Registry outage
/// then degrades the sidebar to last-known metadata instead of removing it.
/// </para>
/// <para>
/// Health is deliberately NOT replicated. It is rewritten on an interval by the registry's health
/// probe, so a copy here would be stale by construction and a cached tree would report the wrong
/// status — the exact bug the probe exists to prevent. The host overlays health from the registry's
/// own endpoint instead.
/// </para>
/// </summary>
public class RemoteAppNavMetadata
{
    /// <summary>Shares the feature's primary key — exactly one metadata row per remote-app feature.</summary>
    public Guid FeatureId { get; set; }
    public PermissionFeature? Feature { get; set; }

    public string? IconKey { get; set; }

    public required string ManifestUrl { get; set; }

    /// <summary>The Module Federation container name, needed to mount the remote.</summary>
    public string? ContainerName { get; set; }

    /// <summary>Active | Maintenance | Disabled, as a string so the two services need not share an enum.</summary>
    public required string Status { get; set; }

    public string? MaintenanceMessage { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}
