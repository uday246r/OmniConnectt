namespace AuthService.Options;

/// <summary>
/// SMTP delivery settings, supplied entirely from configuration (in practice the gitignored .env,
/// alongside the database connection string and the JWT signing key — never committed defaults).
///
/// Provider-agnostic on purpose: the same four settings drive Google Workspace, Microsoft 365, or a
/// corporate relay, so choosing or changing a mail provider never requires a code change.
///
/// Like <see cref="GoogleAuthOptions"/>, an unconfigured deployment is a supported state rather than
/// a startup failure — <see cref="IsConfigured"/> is false, nothing is sent, and the application runs
/// normally. Email is an enhancement to account provisioning, not a prerequisite for it.
/// </summary>
public class SmtpOptions
{
    public const string SectionName = "Smtp";

    public string Host { get; set; } = string.Empty;

    /// <summary>587 (STARTTLS) suits almost every provider; 465 selects implicit TLS.</summary>
    public int Port { get; set; } = 587;

    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;

    /// <summary>Envelope sender. Falls back to <see cref="Username"/>, which is correct for most providers.</summary>
    public string FromAddress { get; set; } = string.Empty;

    public string FromName { get; set; } = "OmniConnect";

    /// <summary>
    /// Absolute base URL of the frontend, used to build invite links (e.g. https://app.example.com).
    /// Required because the API has no reliable way to know the public address of the UI: the Host
    /// header is attacker-controllable, and an invite link is exactly the kind of thing that must
    /// never be built from one.
    /// </summary>
    public string AppBaseUrl { get; set; } = string.Empty;

    /// <summary>How long a set-password invite stays valid.</summary>
    public int InviteValidHours { get; set; } = 48;

    /// <summary>
    /// How long a "forgot password" reset link stays valid, in minutes. Deliberately far shorter than
    /// an invite: this link is issued in response to anyone typing an email address into an anonymous
    /// form, not just the account's own owner, so a short window is what limits the damage if the
    /// email is later found in a shared inbox or forwarded by mistake.
    /// </summary>
    public int ResetPasswordValidMinutes { get; set; } = 5;

    public string ResolvedFromAddress => string.IsNullOrWhiteSpace(FromAddress) ? Username : FromAddress;

    /// <summary>
    /// Mail is only attempted when a host, a credible sender AND an app base URL are all present.
    /// AppBaseUrl is part of the check because an invite email without a working link is worse than
    /// no email — it tells the user to expect something that cannot arrive.
    /// </summary>
    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(Host)
        && !string.IsNullOrWhiteSpace(ResolvedFromAddress)
        && !string.IsNullOrWhiteSpace(AppBaseUrl);
}
