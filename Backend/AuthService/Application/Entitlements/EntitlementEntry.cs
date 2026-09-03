using AuthService.Domain.Enums;

namespace AuthService.Application.Entitlements;

/// <summary>
/// One feature's licensing state, flattened for evaluation. Deliberately a plain record with no EF
/// types so <see cref="EntitlementResolver"/> stays a pure function and can be unit-tested — and
/// shipped to the other services over <c>/internal/entitlements</c> — without a DbContext.
/// </summary>
public sealed record EntitlementEntry(
    string FeatureKey,
    EntitlementStatus Status,
    EntitlementVisibility Visibility,
    string? PlanTier,
    string? LockReason,
    DateTimeOffset? ExpiresAt)
{
    /// <summary>
    /// The state every feature without a row falls back to. See ModuleEntitlement's remarks on why
    /// entitlement fails open where permission fails closed.
    /// </summary>
    public static EntitlementEntry LicensedDefault(string featureKey) => new(
        featureKey,
        EntitlementStatus.Licensed,
        EntitlementVisibility.Normal,
        PlanTier: null,
        LockReason: null,
        ExpiresAt: null);
}

/// <summary>How an effective entitlement presents in the navigation tree and at the API boundary.</summary>
public enum EntitlementOutcome
{
    /// <summary>Licensed and visible. The only outcome that lets a request through.</summary>
    Available = 0,

    /// <summary>Visible but blocked, with a reason. Rendered as an upsell; refused with 403 not-entitled.</summary>
    Locked = 1,

    /// <summary>Omitted from the tree entirely. Still refused at the API — hiding is presentation, not enforcement.</summary>
    Hidden = 2,
}
