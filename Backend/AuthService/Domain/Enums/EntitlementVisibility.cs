namespace AuthService.Domain.Enums;

/// <summary>
/// How an unavailable feature presents itself in the navigation tree.
/// </summary>
public enum EntitlementVisibility
{
    /// <summary>Presentation follows <see cref="EntitlementStatus"/>: licensed renders normally, unlicensed renders locked.</summary>
    Normal = 0,

    /// <summary>Always rendered, always locked — visible as an upsell even while licensed.</summary>
    Locked = 1,

    /// <summary>Never rendered. The node is absent from the tree entirely, not greyed out.</summary>
    Hidden = 2,
}
