using System.ComponentModel.DataAnnotations;

namespace AuthService.Application.DTOs;

/// <summary>
/// Plain string constants, not an enum. Users/Roles are the two modules AuthService replays in-process
/// (see ApprovalAppService.ReplayAsync's explicit switch cases) — deliberately the SAME key strings as
/// AuthDbSeeder.HostFeatureKeys.SettingsUsers/SettingsRoles (the PermissionFeature keys that already
/// gate access to the Setup — User / Setup — Role screens), not a separate bespoke pair. Reusing the
/// key means CheckerAssignmentAppService.GetAssignableModulesAsync needs zero special-casing for
/// Users/Roles at all — they simply appear in the live PermissionFeature catalog like every other
/// module, exactly as a remote service's modules already do. See migration
/// UnifyUserRoleApprovalModuleKeys for the one-time backfill of pre-existing rows that predate this.
/// </summary>
public static class ApprovalModuleKeys
{
    public const string Users = AuthService.Infrastructure.Seed.AuthDbSeeder.HostFeatureKeys.SettingsUsers;
    public const string Roles = AuthService.Infrastructure.Seed.AuthDbSeeder.HostFeatureKeys.SettingsRoles;
}

public static class ApprovalActionKeys
{
    public const string Create = "Create";
    public const string Update = "Update";
    public const string Delete = "Delete";
    public const string Enable = "Enable";
    public const string Disable = "Disable";
}

public static class ApprovalStatus
{
    public const string Pending = "Pending";
    public const string Approved = "Approved";
    public const string Rejected = "Rejected";
}

public record ApprovalRequestListItemDto(
    Guid Id, string Module, string Action, string? EntityType, string? EntityLabel,
    string Status, Guid MakerId, string? MakerName, Guid CheckerId, string? CheckerName,
    DateTimeOffset RequestedAt, DateTimeOffset? DecidedAt, string? RejectionReason,
    /// <summary>True only for the maker's own approved Create-User requests whose one-time
    /// password has not been collected yet. Carries no secret — just "there is something to
    /// collect" — so it is safe on the same DTO the Approval Center's checker-facing list uses.</summary>
    bool HasTempPassword);

public record ApprovalRequestDetailDto(
    Guid Id, string Module, string Action, string? EntityType, string? EntityId, string? EntityLabel,
    string? OldDataJson, string NewDataJson, string Status,
    Guid MakerId, string? MakerName, Guid CheckerId, string? CheckerName,
    DateTimeOffset RequestedAt, DateTimeOffset? DecidedAt, string? RejectionReason);

/// <summary>Real DB aggregates for the Approval Center's summary cards — never client-derived from a partial page of rows.</summary>
public record ApprovalSummaryDto(int PendingTotal, int ApprovedToday, int RejectedToday, int AssignedToMePending);

public record RejectApprovalRequest(
    [Required(AllowEmptyStrings = false, ErrorMessage = "A rejection reason is required.")]
    [MaxLength(1000, ErrorMessage = "Rejection reason cannot exceed 1000 characters.")]
    string Reason);

/// <summary>Returned instead of the normal success body whenever a mutation was gated and could not be
/// applied directly. HTTP 202 Accepted.</summary>
public record ApprovalPendingDto(
    Guid ApprovalRequestId, string Module, string Action, string CheckerName,
    string Message = "Request submitted for approval.");

/// <summary>
/// Wraps every gated UserAppService/RoleAppService mutation result. Exactly one of the two is set —
/// <see cref="Applied"/> for the ungated (today's-behavior) path, <see cref="Pending"/> for the gated
/// path. Controllers unwrap this back into the original 200/201/204 response shape for the ungated
/// case, so no existing consumer sees any change; only the gated case gets the new 202 shape.
/// </summary>
public record MutationResult<T>(T? Applied, ApprovalPendingDto? Pending)
{
    public static MutationResult<T> Ok(T applied) => new(applied, null);
    public static MutationResult<T> PendingApproval(ApprovalPendingDto pending) => new(default, pending);
}

/// <summary>
/// Details of the already-open request that blocked a new submission. Returned as the
/// <c>pendingRequest</c> extension on the 409 ProblemDetails so the UI can name exactly what is
/// pending, who raised it and who holds it, instead of showing a bare "conflict" message.
/// </summary>
public record PendingApprovalConflictDto(
    Guid ApprovalRequestId,
    string Module,
    string Action,
    string? EntityLabel,
    string? MakerName,
    string? CheckerName,
    DateTimeOffset RequestedAt,
    /// <summary>True when the blocked maker is also the one who raised the open request — lets the UI
    /// say "You already have…" rather than naming them in the third person.</summary>
    bool IsOwnRequest);

/// <summary>
/// One assignment targets a user OR a role — exactly one of <paramref name="CheckerUserId"/> and
/// <paramref name="CheckerRoleId"/> is populated. <paramref name="CheckerName"/> carries whichever
/// name applies so the UI has one field to render, and <paramref name="MemberCount"/> is the number
/// of active members a role currently expands to (null for a user assignment) — an administrator
/// needs to see that "Manager" means three people today, and especially that it means zero.
/// </summary>
public record CheckerAssignmentDto(
    Guid Id,
    string Module,
    Guid? CheckerUserId,
    Guid? CheckerRoleId,
    string CheckerName,
    bool IsRole,
    int? MemberCount,
    DateTimeOffset CreatedAt);

/// <summary>
/// Supply exactly one of the two ids. Neither is marked [Required] individually because either is a
/// valid choice; the "exactly one" rule is checked in the service, where it can produce a message
/// that names the actual problem.
/// </summary>
public record UpsertCheckerAssignmentRequest(
    [Required(AllowEmptyStrings = false, ErrorMessage = "Module is required.")]
    string Module,
    Guid? CheckerUserId,
    Guid? CheckerRoleId);

/// <summary>
/// Assigns one checker to every module in <paramref name="Modules"/> in a single call — "assign one
/// checker for a whole application at once" instead of repeating the single-module Upsert per module.
/// Same "exactly one of CheckerUserId/CheckerRoleId" rule as the single form, checked once for the
/// whole batch rather than per module.
/// </summary>
public record BulkUpsertCheckerAssignmentRequest(
    [Required(ErrorMessage = "Select at least one module.")]
    [MinLength(1, ErrorMessage = "Select at least one module.")]
    IReadOnlyList<string> Modules,
    Guid? CheckerUserId,
    Guid? CheckerRoleId);

/// <summary>One module the Checker Assignment UI may offer a checker for — either <see cref="ApprovalModuleKeys.Users"/>/
/// <see cref="ApprovalModuleKeys.Roles"/>, or a live PermissionFeature.Key from any registered remote app.</summary>
public record AssignableModuleDto(string Key, string Label);

/// <summary>Generic payload AuthService POSTs to a remote service's own internal/approvals/apply endpoint
/// when replaying an approved mutation that originated there. Mirrors RecordAuditLogRequest's role as the
/// one shared shape every service agrees on, without a shared package.</summary>
public record ApplyApprovedMutationRequest(
    string Module, string Action, string? EntityType, string? EntityId, string NewDataJson,
    Guid ActingUserId, string? ActingUserName, string? CorrelationId);

/// <summary>Body a remote service POSTs to internal/approvals/submit to gate one of its own mutations.</summary>
public record SubmitInternalApprovalRequest(
    string Module, string Action, string? EntityType, string? EntityId, string? EntityLabel,
    string? OldDataJson, string NewDataJson, Guid MakerId, string SourceService, string CallbackUrl, string? CorrelationId,
    /// <summary>
    /// The dedupe key behind the one-open-request-per-record guarantee. Optional, and null is correct
    /// for any action against a record that already has an id — SubmitAsync falls back to EntityId.
    /// A remote MUST supply this for Create, which has no id yet: without it the key is null, Postgres
    /// treats NULLs as distinct, and the partial unique index stops preventing duplicate Creates.
    /// </summary>
    string? EntityKey = null);

/// <summary>
/// The one and only time this value is ever transmitted. Returned by POST
/// /api/approvals/{id}/reveal-temp-password to the request's MAKER, after which the stored
/// ciphertext no longer exists. Includes the account identity so the maker can tell which login
/// it belongs to without a second lookup.
/// </summary>
public record RevealTempPasswordResponse(string TemporaryPassword, string UserName, string UserEmail);
