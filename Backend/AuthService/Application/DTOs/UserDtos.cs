using System.ComponentModel.DataAnnotations;

namespace AuthService.Application.DTOs;

public record UserListItemDto(
    Guid Id,
    string? Salutation,
    string Name,
    string Email,
    string? PhoneNumber,
    Guid? RoleId,
    string? RoleName,
    bool IsAdministrator,
    bool IsActive,
    DateTimeOffset? LastLoginAt,
    string AuthProvider,
    /// <summary>
    /// The account exists but no invite has ever been redeemed for it, so nobody can sign in yet.
    /// Drives whether Users offers Resend Invite — an action the server refuses for an account that
    /// already has a password, and one there is no point showing on a row it cannot apply to.
    /// </summary>
    bool AwaitingPasswordSetup = false);

public record PermissionOverrideDto(string FeatureKey, string Capability, string Effect);

public record UserDetailDto(
    Guid Id,
    string? Salutation,
    string Name,
    string Email,
    string? PhoneNumber,
    Guid? RoleId,
    string? RoleName,
    bool IsAdministrator,
    bool IsActive,
    bool MustChangePassword,
    DateTimeOffset? LastLoginAt,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    IReadOnlyList<PermissionOverrideDto> PermissionOverrides,
    string AuthProvider,
    IReadOnlyDictionary<string, string>? CustomFields = null);

/*
 * Field validation lives here as data annotations, so [ApiController] rejects a bad request with a 400
 * and a per-field error list before it reaches any service.
 *
 * There was previously none at all, only duplicate-email and role-exists checks. Verified against the
 * running service before this was added: POST /api/users with {"name":"","email":"not-an-email"}
 * returned 201 and created the account, POST /api/roles with an empty name returned 201, and a
 * 5000-character name produced a 500 — the string exceeded the column length and the database error
 * surfaced as an unhandled exception instead of a validation message.
 *
 * Every MaxLength below matches the HasMaxLength in AuthDbContext for that column. That is the whole
 * point: a value the API accepts must be a value the schema can store, or the check has just moved the
 * failure from a clean 400 to a 500.
 */

/// <summary>AuthProvider defaults "Local" and is immutable after creation (like RemoteApp.Key) — switching an existing account between Local and Google mid-life is a deliberately unsupported edge case for v1, avoiding a half-defined credential-transition flow.</summary>
public record CreateUserRequest(
    [Required(AllowEmptyStrings = false, ErrorMessage = "Name is required.")]
    [MaxLength(200, ErrorMessage = "Name cannot exceed 200 characters.")]
    string Name,

    [Required(AllowEmptyStrings = false, ErrorMessage = "Email is required.")]
    [EmailAddress(ErrorMessage = "Enter a valid email address.")]
    [MaxLength(320, ErrorMessage = "Email cannot exceed 320 characters.")]
    string Email,

    // Required, and digit-bounded rather than only character-checked. The old rule accepted "1" and a
    // 40-digit string because it validated the alphabet but never how many digits were present.
    // E.164 caps a full international number at 15 digits and nothing under 7 is dialable; the shape
    // stays loose because +91 98765 43210, 098765-43210 and (022) 2222 3333 are all legitimate.
    [Required(AllowEmptyStrings = false, ErrorMessage = "Phone number is required.")]
    [MaxLength(32, ErrorMessage = "Phone number cannot exceed 32 characters.")]
    [RegularExpression(@"^(?=(?:\D*\d){7,15}\D*$)[0-9+()\-.\s]+$", ErrorMessage = "Enter a valid phone number (7-15 digits).")]
    string PhoneNumber,

    Guid? RoleId,
    bool IsActive = true,
    string AuthProvider = "Local",

    /// <summary>
    /// Values for admin-defined custom fields from the current UserFieldSchema (e.g. "aadharNumber") —
    /// never Name/Email/PhoneNumber, which stay the typed properties above. Any key here that isn't a
    /// currently-defined, non-core field is silently dropped rather than stored — see
    /// UserAppService.ValidateAndBuildExtraAttributesAsync.
    /// </summary>
    IReadOnlyDictionary<string, string>? CustomFields = null,

    /// <summary>Title/salutation (Mr., Ms., ...) — must match an entry in the current SalutationCatalog
    /// if provided; null/empty is always allowed (optional field).</summary>
    string? Salutation = null);

/// <summary>
/// Response returned after a user account is successfully created.
///
/// <paramref name="InviteEmailed"/> is true when a set-password invitation email was successfully
/// delivered to the new user's email address. When false (SMTP not configured, or delivery failed)
/// the user has no way to log in yet, and an administrator recovers it with
/// POST /api/users/{id}/resend-invite once mail is working.
///
/// No credential is ever returned to the caller: the user sets their own password by following the
/// link in the invitation email, which is the only thing that turns the account into a usable login.
/// </summary>
public record CreateUserResponse(UserDetailDto User, bool InviteEmailed = false);

/// <summary>
/// <paramref name="Emailed"/> is false only when SMTP accepted the request but delivery failed — an
/// ineligible account (already set up, disabled, Google-backed, still inside the resend cooldown) is
/// refused outright rather than reported here, so the caller gets a reason instead of a silent no-op.
/// </summary>
public record ResendInviteResponse(bool Emailed);

public record UpdateUserRequest(
    [Required(AllowEmptyStrings = false, ErrorMessage = "Name is required.")]
    [MaxLength(200, ErrorMessage = "Name cannot exceed 200 characters.")]
    string Name,

    [Required(AllowEmptyStrings = false, ErrorMessage = "Email is required.")]
    [EmailAddress(ErrorMessage = "Enter a valid email address.")]
    [MaxLength(320, ErrorMessage = "Email cannot exceed 320 characters.")]
    string Email,

    // Required, and digit-bounded rather than only character-checked. The old rule accepted "1" and a
    // 40-digit string because it validated the alphabet but never how many digits were present.
    // E.164 caps a full international number at 15 digits and nothing under 7 is dialable; the shape
    // stays loose because +91 98765 43210, 098765-43210 and (022) 2222 3333 are all legitimate.
    [Required(AllowEmptyStrings = false, ErrorMessage = "Phone number is required.")]
    [MaxLength(32, ErrorMessage = "Phone number cannot exceed 32 characters.")]
    [RegularExpression(@"^(?=(?:\D*\d){7,15}\D*$)[0-9+()\-.\s]+$", ErrorMessage = "Enter a valid phone number (7-15 digits).")]
    string PhoneNumber,

    Guid? RoleId,

    /// <summary>
    /// Whether the account may sign in. Added because the edit form's "Account is Active" toggle had
    /// nothing to persist into — it moved, the form saved, and the status silently did not change.
    ///
    /// Defaults to true so an older client that omits the field cannot accidentally deactivate the
    /// account it is editing.
    /// </summary>
    bool IsActive = true,

    /// <summary>Same as CreateUserRequest.CustomFields.</summary>
    IReadOnlyDictionary<string, string>? CustomFields = null,

    /// <summary>Same as CreateUserRequest.Salutation.</summary>
    string? Salutation = null);

public record UpdateUserStatusRequest(bool IsActive);

public record UpdateUserPermissionOverridesRequest(IReadOnlyList<PermissionOverrideDto> Overrides);

/// <summary>
/// The real PUT /api/users/{id} wire shape ONLY — how the frontend submits a core-field edit bundled
/// with the "Extra Permissions" grid in one call, so a checker reviews and approves both together
/// (previously two separate calls, and the second was silently skipped whenever the first was gated —
/// the overrides were discarded with no error, no audit trail, and no way to know). This is never what
/// gets stored in an ApprovalRequest's NewDataJson — see UserSnapshotDto for that flat, display-ready
/// shape; UpdateAsync converts between the two.
/// </summary>
public record UpdateUserWithOverridesRequest(
    UpdateUserRequest User,
    IReadOnlyList<PermissionOverrideDto>? Overrides = null);

/// <summary>Same bundling as <see cref="UpdateUserWithOverridesRequest"/>, for account creation — a
/// brand-new user has no id yet to attach overrides to via a follow-up call, so they must travel with
/// the create request itself and get applied once the account (and its id) actually exists.</summary>
public record CreateUserWithOverridesRequest(
    CreateUserRequest User,
    IReadOnlyList<PermissionOverrideDto>? Overrides = null);

/// <summary>
/// The ONE flat shape used for BOTH OldDataJson and NewDataJson on every gated Users mutation
/// (Create/Update/Delete) — never nested, never nested-and-different-from-the-old-side, so
/// ApprovalCenterPage's diff view can render Before/Requested Change with identical field names and a
/// generic RoleId→RoleName lookup instead of unpacking a "User: {...}" wrapper object. Never
/// deserialized back into a live CreateUserRequest/UpdateUserRequest directly — ApprovalAppService.
/// ReplayAsync reconstructs the real request type's fields from this on replay. RoleName is always
/// resolved server-side, never trusted from a client-supplied value. AuthProvider is null except on a
/// Create snapshot (Update/Delete never change it).
/// </summary>
/// Overrides is nullable, distinct from an empty array: null means this mutation never touched
/// overrides at all (replay must leave existing overrides alone); an empty array means the request
/// explicitly asks for zero overrides (replay must wipe them). Collapsing this to "?? []" when building
/// either snapshot silently turns every "didn't touch overrides" edit into a full wipe once it replays.
public record UserSnapshotDto(
    string Name, string Email, string? PhoneNumber, Guid? RoleId, string? RoleName, bool IsActive,
    IReadOnlyList<PermissionOverrideDto>? Overrides, string? AuthProvider = null,
    IReadOnlyDictionary<string, string>? CustomFields = null, string? Salutation = null);
