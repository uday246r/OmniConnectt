namespace ModuleRegistry.Options;

/// <summary>
/// Tuning for the background remote-app reachability probe. Every value is configurable rather than
/// hardcoded so a deployment with many remotes (or slow ones) can tune the sweep without a rebuild.
/// </summary>
public class RemoteHealthOptions
{
    public const string SectionName = "RemoteHealth";

    /// <summary>Set false to turn off background probing entirely (health then stays Unknown, which the host renders neutrally).</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// How long to wait after startup before the first sweep. Short, because a first failed probe no
    /// longer reports an app as down — it only starts the failure count.
    /// </summary>
    public TimeSpan StartupDelay { get; set; } = TimeSpan.FromSeconds(2);

    /// <summary>How often to re-probe once every app is settled and healthy.</summary>
    public TimeSpan Interval { get; set; } = TimeSpan.FromSeconds(60);

    /// <summary>
    /// How often to re-probe while any app is not confirmed healthy. Much shorter than
    /// <see cref="Interval"/> so a recovery is noticed in seconds: the stored health is what the host
    /// reads on every page load, so a slow sweep means a stale "Degraded" that refreshing cannot fix.
    /// </summary>
    public TimeSpan UnhealthyInterval { get; set; } = TimeSpan.FromSeconds(5);

    /// <summary>
    /// Consecutive failed probes before an app that HAS been reachable is reported Unreachable.
    /// Two, so a single dropped request cannot raise a false alarm, while a real regression still
    /// surfaces within roughly ten seconds.
    /// </summary>
    public int ConfirmedFailures { get; set; } = 2;

    /// <summary>
    /// Consecutive failed probes before an app that has NEVER been reachable in this process is
    /// reported Unreachable. Deliberately far more generous: such an app is usually still starting —
    /// the remotes build before they serve — and it stays Unknown ("Checking") until this is
    /// exceeded, rather than being announced as broken while it boots. At the unhealthy interval
    /// above this is about half a minute of grace, after which a genuinely misconfigured app is
    /// still reported.
    /// </summary>
    public int StartupGraceFailures { get; set; } = 6;

    /// <summary>Per-request timeout when fetching a manifest. Short on purpose — a hung remote must not stall the sweep.</summary>
    public TimeSpan ProbeTimeout { get; set; } = TimeSpan.FromSeconds(5);

    /// <summary>
    /// How stale a sweep must be before an on-demand refresh actually re-probes. Throttles the
    /// refresh endpoint so holding down F5 cannot turn into a probe storm against the remotes.
    /// </summary>
    public TimeSpan OnDemandMaximumAge { get; set; } = TimeSpan.FromSeconds(3);
}
