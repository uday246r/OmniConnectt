namespace AuthService.Domain.Entities;

/// <summary>
/// One sidebar row belonging to the host application itself, as opposed to a remote app.
/// <para>
/// Kept separate from <see cref="FeatureNavItem"/> because the two have genuinely different
/// lifecycles and route shapes. Host rows are seeded here and hold an ABSOLUTE path
/// ("/system/audit-logs"); remote rows are synced from each remote's own manifest and hold a SEGMENT
/// appended to /apps/{appKey}. Folding them into one table would let the remote sync — which replaces
/// its rows wholesale — delete host navigation.
/// </para>
/// </summary>
public class HostNavItem
{
    public Guid Id { get; set; }

    /// <summary>Stable identifier and the React key the sidebar renders with.</summary>
    public required string Key { get; set; }

    public required string Label { get; set; }

    /// <summary>Resolved to a component by the host's icon registry; an unknown key falls back to a neutral default.</summary>
    public string? IconKey { get; set; }

    /// <summary>Absolute host route, e.g. "/" or "/system/approvals".</summary>
    public required string RoutePath { get; set; }

    public required string SectionKey { get; set; }
    public NavSection? Section { get; set; }

    public int SortOrder { get; set; }

    /// <summary>
    /// The permission feature this row requires, or null when the row is visible to every
    /// authenticated user.
    /// <para>
    /// Nullable rather than a required foreign key because "My Requests" is deliberately ungated: it
    /// shows only the caller's own requests, scoped server-side, so gating it would hide a page from
    /// the very people it exists for. A required relationship would have made that inexpressible.
    /// </para>
    /// </summary>
    public string? RequiredFeatureKey { get; set; }

    /// <summary>Which capability on that feature is needed. Null means any capability on it is enough.</summary>
    public string? RequiredCapability { get; set; }
}
