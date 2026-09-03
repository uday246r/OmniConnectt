namespace AuthService.Domain.Enums;

/// <summary>
/// Whether a feature is commercially available to this deployment.
/// </summary>
public enum EntitlementStatus
{
    /// <summary>Included in the plan and fully usable.</summary>
    Licensed = 0,

    /// <summary>Not included. Rendered locked (or hidden) and refused by the API.</summary>
    Unlicensed = 1,

    /// <summary>Licensed until <see cref="Entities.ModuleEntitlement.ExpiresAt"/>, then treated as Unlicensed.</summary>
    Trial = 2,
}
