namespace AuthService.Domain.Enums;

/// <summary>
/// An administrator's decision about a registered remote app. Distinct from
/// <see cref="RemoteAppHealth"/>, which is an observation: an app can be Active and Unreachable
/// (deployed but down) or Disabled and Healthy (running, but withdrawn from the platform).
/// </summary>
public enum RemoteAppStatus
{
    /// <summary>Mounted normally for anyone holding a capability on it.</summary>
    Active = 0,

    /// <summary>Listed in the sidebar but renders a maintenance notice instead of the remote.</summary>
    Maintenance = 1,

    /// <summary>Withdrawn: hidden from the sidebar AND its permission feature is deactivated, so its
    /// capabilities stop being assignable anywhere in the host.</summary>
    Disabled = 2,
}
