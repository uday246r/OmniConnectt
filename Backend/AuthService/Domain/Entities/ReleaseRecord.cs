using AuthService.Domain.Enums;

namespace AuthService.Domain.Entities;

/// <summary>
/// One published build of the host shell or of a remote app, and whether users are on it.
/// </summary>
/// <remarks>
/// <para>
/// Every build is published to its own immutable folder (<c>/modules/lead/4.7.3/</c>) and never
/// overwritten, so promoting one is a pointer change — <see cref="RemoteApp.ManifestUrl"/> — rather
/// than a redeploy. That is what lets a remote ship without restarting the host or touching any other
/// remote, and what makes a rollback instant: the previous version is still there.
/// </para>
/// <para>
/// This table is the record of those pointer changes: which versions exist, which one is live, who put
/// it there and when, and what each declares it needs (<see cref="RequiredHostBridge"/>) or provides
/// (<see cref="BridgeVersion"/>, for the host). It is what answers "which Lead version is running in
/// production?" without anyone opening a server.
/// </para>
/// </remarks>
public class ReleaseRecord
{
    /// <summary>The app key that names the host shell's own rows, which no remote may take.</summary>
    public const string HostKey = "host";

    public Guid Id { get; set; }

    /// <summary>The remote app's key, or <see cref="HostKey"/>.</summary>
    public required string Key { get; set; }

    /// <summary>The build's version folder: <c>4.7.3</c>.</summary>
    public required string Version { get; set; }

    /// <summary>Root-relative manifest path for a remote; null for the host.</summary>
    public string? ManifestUrl { get; set; }

    /// <summary>The Module Federation container name the manifest declared when it was registered.</summary>
    public string? ContainerName { get; set; }

    /// <summary>The SemVer range of host bridges this remote works with, from its manifest.</summary>
    public string? RequiredHostBridge { get; set; }

    /// <summary>The host bridge version this host build provides. Host rows only.</summary>
    public string? BridgeVersion { get; set; }

    /// <summary>SHA-256 of the published folder, from the release manifest — the same version can never be republished with different content.</summary>
    public string? Checksum { get; set; }

    /// <summary>The release that delivered this build (release-manifest.json's releaseVersion).</summary>
    public string? ReleaseId { get; set; }

    public ReleaseStatus Status { get; set; } = ReleaseStatus.Staged;

    public DateTimeOffset RegisteredAt { get; set; }

    public DateTimeOffset? PromotedAt { get; set; }

    /// <summary>Who made it live: the release pipeline, or an administrator's name.</summary>
    public string? PromotedBy { get; set; }
}
