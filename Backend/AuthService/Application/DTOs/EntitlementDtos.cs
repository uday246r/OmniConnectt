using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using AuthService.Domain.Enums;

namespace AuthService.Application.DTOs;

/*
 * Status and Visibility cross the wire as STRINGS on this contract.
 *
 * This service configures no global JsonStringEnumConverter, so by default they would serialise as
 * ordinals and the browser would depend on two C# enums keeping their member order forever —
 * inserting a value in the middle of either would silently re-map every licence on screen with
 * nothing failing to announce it. The same reasoning already applies to the internal entitlement
 * feed; applying it per-property here keeps every other endpoint's serialisation untouched.
 */

/// <summary>One feature's licensing state as the admin screen sees it, with its sub-modules nested beneath.</summary>
public record EntitlementNodeDto(
    string FeatureKey,
    string DisplayName,
    bool IsActive,
    int SortOrder,
    [property: JsonConverter(typeof(JsonStringEnumConverter))] EntitlementStatus Status,
    [property: JsonConverter(typeof(JsonStringEnumConverter))] EntitlementVisibility Visibility,
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
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public EntitlementStatus Status { get; init; }

    [Required]
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public EntitlementVisibility Visibility { get; init; }

    [MaxLength(50)]
    public string? PlanTier { get; init; }

    [MaxLength(500)]
    public string? LockReason { get; init; }

    public DateTimeOffset? ExpiresAt { get; init; }
}
