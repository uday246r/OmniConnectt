namespace AuthService.Domain.Enums;

/// <summary>
/// The last observed reachability of a remote app's Module Federation manifest, written by the
/// background health probe. Never inferred — an app that has not been probed reports
/// <see cref="Unknown"/> rather than a guess.
/// </summary>
public enum RemoteAppHealth
{
    Unknown = 0,
    Healthy = 1,
    Unreachable = 2,
}
