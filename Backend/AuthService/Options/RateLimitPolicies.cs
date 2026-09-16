namespace AuthService.Options;

/// <summary>Named rate-limit policies, referenced by [EnableRateLimiting] on controllers.</summary>
public static class RateLimitPolicies
{
    /// <summary>
    /// Unauthenticated credential endpoints — login and Google sign-in. Partitioned by client IP,
    /// because there is no user identity to partition by yet.
    /// </summary>
    public const string Authentication = "auth";

    /// <summary>
    /// Authenticated but security-sensitive operations, chiefly changing a password. Partitioned by
    /// user id, so one account cannot be used to exhaust the limit for everyone behind the same
    /// corporate NAT — which a bank branch office very much is.
    /// </summary>
    public const string Sensitive = "sensitive";

    /// <summary>
    /// Page-view recording. Partitioned by user id. Generous enough for someone clicking quickly
    /// through the sidebar, low enough that a script looping on the endpoint cannot fill the audit table.
    /// </summary>
    public const string PageViews = "page-views";
}

/// <summary>
/// Rate-limit thresholds, in configuration so they can be tuned per deployment without a rebuild.
/// Bound from the "RateLimiting" section.
///
/// Before this existed there was no rate limiting anywhere in the service: /api/auth/login accepted
/// unlimited attempts per second from a single address, which makes offline-quality brute force
/// possible online against any account whose password is weak.
/// </summary>
public class RateLimitOptions
{
    public const string SectionName = "RateLimiting";

    /// <summary>Set false only for local load testing. Leaving this off in production removes the brute-force protection entirely.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Login attempts permitted per IP per window.</summary>
    public int AuthPermitLimit { get; set; } = 10;

    public int AuthWindowSeconds { get; set; } = 60;

    /// <summary>
    /// How many requests may queue rather than being rejected outright. Zero: a caller over the limit
    /// gets an immediate 429 instead of occupying a server thread waiting, which is the behaviour that
    /// keeps the endpoint cheap to reject.
    /// </summary>
    public int AuthQueueLimit { get; set; }

    /// <summary>Password changes permitted per user per window.</summary>
    public int SensitivePermitLimit { get; set; } = 5;

    public int SensitiveWindowSeconds { get; set; } = 300;

    /// <summary>Page views accepted per user per window. Over the limit the view is simply not recorded.</summary>
    public int PageViewPermitLimit { get; set; } = 60;

    public int PageViewWindowSeconds { get; set; } = 60;
}
