namespace AuthService.Domain.Entities;

/// <summary>
/// One row a feature contributes to the host sidebar.
/// <para>
/// Many-to-one with the feature, not one-to-one, and that is the whole reason this table exists.
/// "View Leads" and "Create Lead" are both the <c>remote.lead.lead</c> feature, differing only in
/// <see cref="RequiredCapability"/>; Individual and Non-Individual are both Customer 360's profile
/// feature. Hanging a single label and route off the feature row would have silently deleted one row
/// from each pair.
/// </para>
/// <para>
/// Replicated from the remote's own declaration through the Module Registry sync. Rows are fully
/// replaced when a remote reports its navigation and left untouched when it does not, so a remote
/// that is briefly unreachable keeps its sidebar rather than losing it.
/// </para>
/// </summary>
public class FeatureNavItem
{
    public Guid Id { get; set; }

    public Guid FeatureId { get; set; }
    public PermissionFeature? Feature { get; set; }

    /// <summary>Stable identifier within the feature, and the last URL segment: <c>/apps/lead/{NavKey}</c>.</summary>
    public required string NavKey { get; set; }

    public required string Label { get; set; }

    /// <summary>Resolved to a component by the host's icon registry. Null falls back to a neutral default.</summary>
    public string? IconKey { get; set; }

    public required string RouteSegment { get; set; }

    public int SortOrder { get; set; }

    /// <summary>
    /// Which capability on the owning feature this row needs. Null means any capability on the
    /// feature is enough — the right default for a module whose single page is its whole surface.
    /// </summary>
    public string? RequiredCapability { get; set; }
}
