using AuthService.Domain.Enums;

namespace AuthService.Domain.Entities;

/// <summary>
/// Whether a feature is commercially available — the licensing dimension, kept deliberately separate
/// from the permission dimension (<see cref="RolePermission"/>, <see cref="UserPermissionOverride"/>).
/// <para>
/// The two answer different questions. Permission asks "is this user allowed to do it"; entitlement
/// asks "did this deployment buy it". Both must pass. Keeping them apart is what lets a module be
/// sold as an add-on without touching a single role, and lets a role be authored against a module
/// the customer has not licensed yet.
/// </para>
/// <para>
/// <b>This table fails OPEN, which inverts the default posture everywhere else in this codebase.</b>
/// A feature with no row is treated as Licensed. That is deliberate: entitlement is a commercial
/// control, not a security boundary, and a missing row must never black out a module that worked
/// yesterday — every feature predating this table has no row. Permission remains fail-closed and is
/// still the thing standing between a user and data they may not see. Do not "fix" this to fail
/// closed without also backfilling every feature.
/// </para>
/// </summary>
public class ModuleEntitlement
{
    public Guid Id { get; set; }

    /// <summary>The feature this licenses. Applies to sub-modules through the parent when they have no row of their own.</summary>
    public Guid FeatureId { get; set; }

    public PermissionFeature? Feature { get; set; }

    /// <summary>
    /// RESERVED — always null today, and nothing reads it yet.
    /// <para>
    /// This deployment is single-tenant: there is no Company entity, and <see cref="User"/> has no
    /// company link. The column exists so that when one arrives, per-company rows can be inserted
    /// alongside the platform default and resolved "most specific wins" — a company row shadows the
    /// null-company row — WITHOUT changing the navigation DTO, the resolution order, or any caller.
    /// The unique index below already reserves exactly one platform-default row per feature.
    /// </para>
    /// </summary>
    public Guid? CompanyId { get; set; }

    public EntitlementStatus Status { get; set; } = EntitlementStatus.Licensed;

    public EntitlementVisibility Visibility { get; set; } = EntitlementVisibility.Normal;

    /// <summary>Free-text plan label shown in the admin UI, e.g. "Included", "Pro", "Enterprise". Not interpreted by any gate.</summary>
    public string? PlanTier { get; set; }

    /// <summary>Operator-authored explanation surfaced verbatim to the user on the locked screen.</summary>
    public string? LockReason { get; set; }

    /// <summary>Null means perpetual. A date in the past is evaluated exactly as Unlicensed, so a lapsed trial needs no sweep job.</summary>
    public DateTimeOffset? ExpiresAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public Guid? UpdatedBy { get; set; }
}
