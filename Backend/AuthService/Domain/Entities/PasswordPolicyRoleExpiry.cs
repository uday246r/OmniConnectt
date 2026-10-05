namespace AuthService.Domain.Entities;

/// <summary>
/// A role's own password lifetime, one row per role that has one. A role with no row inherits the global
/// lifetime held in <see cref="PasswordPolicyCatalog"/>.
/// </summary>
/// <remarks>
/// <para>
/// This used to live inside the policy's JSON, where the link to a role was a GUID in a string that the
/// database could not see: no foreign key, no cascade, and nothing stopping a deleted role's id from
/// lingering there. As a table, <see cref="RoleId"/> is a real foreign key to <c>Roles</c> — the database
/// itself refuses an override for a role that does not exist, and removes the override when the role is
/// deleted.
/// </para>
/// <para>
/// The primary key is the role, so a role can hold at most one override by construction.
/// </para>
/// </remarks>
public class PasswordPolicyRoleExpiry
{
    /// <summary>The role this lifetime applies to. Primary key and foreign key to <c>Roles.Id</c>.</summary>
    public Guid RoleId { get; set; }

    public Role Role { get; set; } = null!;

    /// <summary>Days a password held by this role lives. Never 0 — "inherit" is the absence of a row.</summary>
    public int ExpiryDays { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
    public Guid? UpdatedBy { get; set; }
}
