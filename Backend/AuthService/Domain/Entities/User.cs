using AuthService.Domain.Enums;

namespace AuthService.Domain.Entities;

public class User
{
    public Guid Id { get; set; }

    /// <summary>Title/salutation (Mr., Ms., Dr., ...) — optional, drawn from the admin-configurable
    /// SalutationCatalog. Like Role, this is a fixed dropdown with an editable value list, not part of
    /// UserFieldSchema.</summary>
    public string? Salutation { get; set; }

    public required string Name { get; set; }
    public required string Email { get; set; }
    public string? PhoneNumber { get; set; }

    /// <summary>Null for Google-provisioned accounts — they never have a local password, see AuthProvider.</summary>
    public string? PasswordHash { get; set; }

    /// <summary>How this user signs in. Google accounts are still admin-provisioned here (same as Local) — SSO never auto-creates a User row, it only authenticates an already-existing one.</summary>
    public AuthProvider AuthProvider { get; set; } = AuthProvider.Local;

    public UserStatus Status { get; set; } = UserStatus.Active;

    /// <summary>
    /// Soft-delete flag, distinct from Status. Status toggles sign-in ability (the Active switch in
    /// Setup &gt; User) while still listing the account; IsDeleted removes it from listings entirely
    /// (the row is kept, never hard-deleted, so audit/FK history stays intact).
    /// </summary>
    public bool IsDeleted { get; set; }

    /// <summary>Single role per user (v1) — matches the platform's one-Role-column user table. Fine-tuning happens via UserPermissionOverride.</summary>
    public Guid? RoleId { get; set; }
    public Role? Role { get; set; }

    /// <summary>Forces a password change on next login — used for system-generated temporary passwords or expired passwords.</summary>
    public bool MustChangePassword { get; set; }

    /// <summary>When the user last set or rotated their password — the start of the expiry clock. Null for
    /// an account that has never recorded a change, in which case <see cref="CreatedAt"/> is used.</summary>
    public DateTimeOffset? PasswordChangedAt { get; set; }

    /// <summary>
    /// The smallest reminder threshold (days before expiry) already emailed for the CURRENT password, so
    /// the reminder job sends each threshold once. Cleared whenever the password changes, which is what
    /// restarts the sequence for the next rotation.
    /// </summary>
    public int? PasswordExpiryReminderSentDay { get; set; }

    public DateTimeOffset? LastLoginAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public Guid? CreatedBy { get; set; }
    public Guid? UpdatedBy { get; set; }

    /// <summary>
    /// Values for admin-defined custom fields (e.g. Aadhar Number) that aren't one of the fixed
    /// core columns above — see UserFieldSchema. Stored as a jsonb object of fieldKey -> string value.
    /// Null for a user with no custom field values set.
    /// </summary>
    public string? ExtraAttributes { get; set; }

    public ICollection<UserPermissionOverride> PermissionOverrides { get; set; } = new List<UserPermissionOverride>();
    public ICollection<RefreshToken> RefreshTokens { get; set; } = new List<RefreshToken>();
}
