using System.ComponentModel.DataAnnotations;
using AuthService.Domain.Enums;

namespace AuthService.Application.DTOs;

/// <summary>One feature's licensing state as the admin screen sees it, with its sub-modules nested beneath.</summary>
public record EntitlementNodeDto(
    string FeatureKey,
    string DisplayName,
    bool IsActive,
    int SortOrder,
    EntitlementStatus Status,
    EntitlementVisibility Visibility,
    string? PlanTier,
    string? LockReason,
    DateTimeOffset? ExpiresAt,
    /// <summary>False when this row inherits from its parent rather than holding an entitlement of its own — the admin UI shows it greyed with an "inherited" hint.</summary>
    bool HasOwnEntitlement,
    /// <summary>The outcome after expiry and inheritance are applied, so the screen shows what actually happens, not just what is stored.</summary>
    string EffectiveOutcome,
    IReadOnlyList<EntitlementNodeDto> Children);

public record UpdateEntitlementRequest
{
    [Required]
    public EntitlementStatus Status { get; init; }

    [Required]
    public EntitlementVisibility Visibility { get; init; }

    [MaxLength(50)]
    public string? PlanTier { get; init; }

    [MaxLength(500)]
    public string? LockReason { get; init; }

    public DateTimeOffset? ExpiresAt { get; init; }
}
