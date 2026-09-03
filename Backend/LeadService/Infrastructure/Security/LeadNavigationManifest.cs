namespace LeadManagement.Api.Infrastructure.Security;

/// <summary>
/// The sidebar this remote contributes: which pages exist, what they are called, what icon they
/// carry, and where they live in the host's URL space.
/// </summary>
/// <remarks>
/// Reflection over [RequiresCapability] discovers the authoritative capability set but can never
/// produce this. Those attributes are per-ENDPOINT and carry no display data — today the module's
/// DisplayName is literally the raw module string, which is why the Role editor shows "FieldSettings"
/// and "AuditLog". Labels, icons, route segments and ordering have to be declared somewhere.
///
/// Nav items are a LIST under a module, not one per module, because they are not one-to-one:
/// "View Leads" and "Create Lead" are both the Lead module, separated only by which capability they
/// need (Lead:View vs Lead:Create). A design that assumed one nav row per module would silently drop
/// "Create Lead" the day it shipped.
///
/// A module with an empty Nav list is grantable but not navigable — MasterData is real permission
/// surface with no page of its own. Declaring it explicitly distinguishes that from having forgotten
/// it, which the discovery endpoint logs as a warning.
/// </remarks>
public static class LeadNavigationManifest
{
    /// <param name="Key">Stable id, and the last URL segment: /apps/lead/{Key}.</param>
    /// <param name="RequiredCapability">Null means "any capability on the module is enough to see this row".</param>
    public sealed record NavItem(
        string Key,
        string Label,
        string IconKey,
        int SortOrder,
        string? RequiredCapability = null);

    public sealed record NavModule(
        string ModuleKey,
        string DisplayName,
        int SortOrder,
        IReadOnlyList<NavItem> Nav);

    /// <summary>
    /// Module keys are matched case-insensitively against the [RequiresCapability] module argument,
    /// which is authored by hand and inconsistently cased.
    /// </summary>
    public static readonly IReadOnlyList<NavModule> Modules =
    [
        new("Dashboard", "Dashboard", 10,
        [
            new("dashboard", "Dashboard", "LayoutDashboard", 10, "View"),
        ]),
        new("Lead", "Leads", 20,
        [
            new("view-lead", "View Leads", "Users", 10, "View"),
            new("create-lead", "Create Lead", "UserPlus", 20, "Create"),
        ]),
        new("AuditLog", "Audit Logs", 30,
        [
            new("audit-logs", "Audit Logs", "ShieldCheck", 10, "View"),
        ]),
        new("FieldSettings", "Field Settings", 40,
        [
            new("field-settings", "Field Settings", "Settings", 10, "Manage"),
        ]),
        // Permission surface with no page: master data is read by the lead forms, never browsed.
        new("MasterData", "Master Data", 50, []),
    ];

    public static NavModule? Find(string moduleKey) =>
        Modules.FirstOrDefault(m => string.Equals(m.ModuleKey, moduleKey, StringComparison.OrdinalIgnoreCase));
}
