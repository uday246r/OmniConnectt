namespace AuthService.Options;

/// <summary>
/// Tuning for the background sweep that emails people before their password expires.
/// <para>
/// WHICH days to warn on, and whether email is used at all, are the administrator's choice on Settings &gt;
/// Manage Password Policy and live in the database. These are only the operational knobs — how often the
/// sweep looks — which belong to whoever deploys the service, not to a policy editor.
/// </para>
/// </summary>
public class PasswordExpiryReminderOptions
{
    public const string SectionName = "PasswordExpiryReminder";

    /// <summary>Set false to disable the sweep on this instance (in-app banners are unaffected).</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Delay before the first sweep, so it never contends with startup migrations and seeding.</summary>
    public TimeSpan StartupDelay { get; set; } = TimeSpan.FromMinutes(3);

    /// <summary>
    /// How often to look. Reminder thresholds are whole days, so a few sweeps a day is ample; each user
    /// still gets one email per threshold no matter how often this runs.
    /// </summary>
    public TimeSpan Interval { get; set; } = TimeSpan.FromHours(6);

    /// <summary>Users examined per database round trip, so a large directory is never loaded in one query.</summary>
    public int BatchSize { get; set; } = 500;
}
