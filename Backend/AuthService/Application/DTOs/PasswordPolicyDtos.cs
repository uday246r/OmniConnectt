namespace AuthService.Application.DTOs;

/// <summary>
/// A role's own password lifetime. A role with no entry inherits the global <c>ExpiryDays</c>; an entry
/// REPLACES it (it is not clamped to the global value — a role override is the whole answer, which is
/// what an auditor expects "this role rotates every 30 days" to mean).
/// </summary>
public record RolePasswordExpiryDto(Guid RoleId, int ExpiryDays);

/// <summary>
/// When and where the advance-expiry warning goes out.
/// <paramref name="LeadDays"/> are days before expiry, e.g. [14, 7, 3, 1]: one email is sent as each
/// threshold is crossed.
/// </summary>
public record PasswordExpiryNotificationDto(
    bool Email = true,
    bool InApp = true,
    IReadOnlyList<int>? LeadDays = null);

/// <summary>
/// What a NEW password must satisfy. Moved off the appsettings-only <c>PasswordPolicyOptions</c> so an
/// administrator can change it without a redeploy; the options are now only the seed for the first row.
/// Global — roles differ in how long a password lives, not in what a good one looks like.
/// </summary>
public record PasswordComplexityDto(
    int MinimumLength = 12,
    int MaximumLength = 128,
    bool RequireUppercase = true,
    bool RequireLowercase = true,
    bool RequireDigit = true,
    bool RequireNonAlphanumeric = true,
    bool RejectSameAsCurrent = true)
{
    /// <summary>Human-readable description of the rules, built from the values themselves so it can never
    /// drift from what <see cref="Validate"/> actually checks.</summary>
    public string Describe()
    {
        var parts = new List<string> { $"at least {MinimumLength} characters" };
        if (RequireUppercase) parts.Add("an uppercase letter");
        if (RequireLowercase) parts.Add("a lowercase letter");
        if (RequireDigit) parts.Add("a digit");
        if (RequireNonAlphanumeric) parts.Add("a symbol");

        return parts.Count == 1
            ? $"Password must be {parts[0]}."
            : $"Password must contain {string.Join(", ", parts.Take(parts.Count - 1))} and {parts[^1]}.";
    }

    /// <summary>Returns null when the candidate satisfies the rules, or the reason it doesn't.</summary>
    public string? Validate(string password)
    {
        if (string.IsNullOrWhiteSpace(password)) return "Password is required.";
        if (password.Length < MinimumLength || password.Length > MaximumLength) return Describe();
        if (RequireUppercase && !password.Any(char.IsUpper)) return Describe();
        if (RequireLowercase && !password.Any(char.IsLower)) return Describe();
        if (RequireDigit && !password.Any(char.IsDigit)) return Describe();
        if (RequireNonAlphanumeric && password.All(char.IsLetterOrDigit)) return Describe();
        return null;
    }
}

/// <summary>
/// The whole policy. <paramref name="ExpiryDays"/> is the global lifetime in days; <c>0</c> means
/// passwords never expire (the off switch for the whole feature).
/// </summary>
public record PasswordPolicyDefinitionDto(
    int ExpiryDays,
    IReadOnlyList<RolePasswordExpiryDto> RoleExpiries,
    PasswordComplexityDto Complexity,
    PasswordExpiryNotificationDto Notifications);

/// <summary>A role the policy page can attach an expiry to, with how many active users hold it — so an
/// administrator can see how many people a role rule affects before saving it.</summary>
public record PasswordPolicyRoleDto(Guid Id, string Name, int UserCount);

/// <param name="Roles">Every role, for the Role Policies tab. Returned here rather than fetched from the roles
/// API because that needs a different permission — someone trusted with password policy but not with role
/// administration would otherwise see an empty tab. Null on the internal read paths that do not need it.</param>
public record PasswordPolicyCatalogDto(
    PasswordPolicyDefinitionDto Policy, int Version, DateTimeOffset UpdatedAt,
    IReadOnlyList<PasswordPolicyRoleDto>? Roles = null);

/// <param name="ExpectedVersion">The version the editor loaded; a different current version is a 409, not a silent overwrite.</param>
public record UpdatePasswordPolicyRequest(PasswordPolicyDefinitionDto Policy, int? ExpectedVersion = null);

/// <summary>
/// Where one user stands against the policy. <c>ExpiresAt</c>/<c>DaysRemaining</c> are null when the
/// password does not expire (policy off, an SSO account, or an invite not yet accepted).
/// </summary>
public record PasswordExpiryStatusDto(
    int EffectiveExpiryDays,
    DateTimeOffset? PasswordChangedAt,
    DateTimeOffset? ExpiresAt,
    int? DaysRemaining,
    bool IsExpired,
    bool IsInWarningWindow);
