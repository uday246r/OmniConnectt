namespace LeadManagement.Api.Infrastructure.Security;

/// <summary>
/// The business capabilities this remote owns that are not endpoints: KPI cards, charts and exports.
/// </summary>
/// <remarks>
/// Reflection over [RequiresCapability] finds every capability that guards an endpoint, and that is
/// all it can ever find. All eight dashboard endpoints here are guarded by the single attribute
/// <c>Dashboard:View</c>, so "let this role see the Conversion Rate card but not the Total Leads
/// card" has nowhere to be written down — not in the attribute, not in the sync payload, not in the
/// permission editor. Splitting the endpoints would not fix it either: one card is drawn from a
/// response that also feeds four others.
/// <para>
/// So the things a business actually wants to grant are declared here instead, and travel the same
/// path as everything else: they become PermissionFeatureCapability rows, they are granted through
/// the ordinary Role and User editors, and they arrive at the browser as
/// <c>{featureKey}:{capability}</c> like every other permission. The only difference is delivery —
/// they are fetched rather than carried in the JWT, which is what stops a token growing past what a
/// proxy will forward once every app declares its own.
/// </para>
/// <para>
/// Everything listed here corresponds to something a user can actually see. Nothing is declared
/// speculatively: there are no bulk actions below because this app has no bulk selection UI, and a
/// capability that gates nothing is a checkbox that lies to whoever ticks it.
/// </para>
/// <para>
/// <b>Which of these are security boundaries, and which are not.</b> Every chart and widget, and the
/// In Progress and Conversion Rate cards, have an endpoint each and are refused server-side by
/// [RequiresFineCapability]. Total Leads, New Leads and Converted share one response and are redacted
/// out of it instead — a different mechanism, the same guarantee. <c>export.csv</c> is neither: the
/// audit CSV is assembled in the browser from rows the user already holds under <c>AuditLog:View</c>,
/// so withholding the button withholds the convenience, not the data. It is worth granting — an
/// export is a distinct act and the audit trail records it — but it must not be mistaken for a
/// control over who can obtain the rows.
/// </para>
/// </remarks>
public static class LeadCapabilityManifest
{
    /// <param name="Key">
    /// Dotted by convention. The prefix becomes the group the permission editor renders it under, so
    /// "kpi.total-leads" sits with the other KPIs without anything hardcoding what a KPI is.
    /// </param>
    /// <param name="Type">
    /// Never "Api". An Api capability is one a filter reads out of the JWT claim, and nothing here is
    /// enforced that way — claiming otherwise would put it in the token and defeat the point.
    /// </param>
    public sealed record Capability(
        string Key,
        string DisplayName,
        string Description,
        string Type,
        int SortOrder);

    public sealed record CapabilityModule(string ModuleKey, IReadOnlyList<Capability> Capabilities);

    /// <summary>
    /// Module keys match the [RequiresCapability] module argument case-insensitively, the same way
    /// <see cref="LeadNavigationManifest"/> matches them.
    /// </summary>
    public static readonly IReadOnlyList<CapabilityModule> Modules =
    [
        new("Dashboard",
        [
            // The five cards in KpiCardSection, in the order they are laid out.
            new("kpi.total-leads", "KPI: Total Leads", "Show the Total Leads card on the dashboard.", "Widget", 110),
            new("kpi.new-leads", "KPI: New Leads", "Show the New Leads card on the dashboard.", "Widget", 120),
            new("kpi.in-progress", "KPI: In Progress", "Show the In Progress card on the dashboard.", "Widget", 130),
            new("kpi.converted", "KPI: Converted", "Show the Converted card on the dashboard.", "Widget", 140),
            new("kpi.conversion-rate", "KPI: Conversion Rate", "Show the Conversion Rate card on the dashboard.", "Widget", 150),

            new("chart.leads-over-time", "Chart: Leads Over Time", "Show the leads-over-time trend chart.", "Chart", 210),
            new("chart.leads-by-product", "Chart: Leads by Product", "Show the distribution of leads by product.", "Chart", 220),
            new("chart.leads-by-branch", "Chart: Leads by Branch", "Show the distribution of leads by branch.", "Chart", 230),

            new("widget.recent-leads", "Widget: Recent Leads", "Show the most recently created leads.", "Widget", 310),
            new("widget.top-sales-executives", "Widget: Top Sales Executives", "Show the top-performing sales executives.", "Widget", 320),
        ]),

        new("AuditLog",
        [
            new("export.csv", "Export audit log to CSV", "Download the audit trail as a CSV file.", "Export", 110),
        ]),
    ];

    public static IReadOnlyList<Capability> For(string moduleKey) =>
        Modules.FirstOrDefault(m => string.Equals(m.ModuleKey, moduleKey, StringComparison.OrdinalIgnoreCase))
            ?.Capabilities ?? [];
}
