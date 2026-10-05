namespace AuthService.Domain.Enums;

/// <summary>Where one published build of the host or a remote stands.</summary>
public enum ReleaseStatus
{
    /// <summary>Published to the web server and registered, but not what users load.</summary>
    Staged = 0,

    /// <summary>What users load now. Exactly one per app key.</summary>
    Live = 1,

    /// <summary>Was live; replaced by a later promotion. Still on disk, and a rollback target.</summary>
    Superseded = 2,
}
