namespace AuthService.Options;

/// <summary>
/// Password rules, in configuration rather than in source so a deploying bank can tighten them to
/// match its own policy without a rebuild. Bound from the "PasswordPolicy" section.
///
/// The defaults follow common Indian banking practice for staff console credentials: at least 12
/// characters with all four character classes. They are deliberately stricter than the ASP.NET
/// Identity defaults, and the seeder's temporary-password generator must keep satisfying them.
/// <para>
/// These values are now only the SEED. Until an administrator first saves the policy on Settings &gt;
/// Manage Password Policy they are what is enforced; from that first save the database row is the
/// authority and this section is no longer read for rules. Validation and the human-readable
/// description live on <c>PasswordComplexityDto</c>, next to the row they apply to.
/// </para>
/// </summary>
public class PasswordPolicyOptions
{
    public const string SectionName = "PasswordPolicy";

    public int MinimumLength { get; set; } = 12;

    /// <summary>
    /// Upper bound, so a caller cannot use the hashing work factor as a denial-of-service vector by
    /// submitting a multi-megabyte password. PBKDF2 cost scales with input length.
    /// </summary>
    public int MaximumLength { get; set; } = 128;

    public bool RequireUppercase { get; set; } = true;
    public bool RequireLowercase { get; set; } = true;
    public bool RequireDigit { get; set; } = true;
    public bool RequireNonAlphanumeric { get; set; } = true;

    /// <summary>
    /// Reject a new password identical to the current one. Not a full history check — storing past
    /// hashes to compare against is its own decision, and this catches the common case of a user
    /// "changing" a password to itself to satisfy a rotation prompt.
    /// </summary>
    public bool RejectSameAsCurrent { get; set; } = true;
}
