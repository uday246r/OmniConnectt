using static AuthService.Infrastructure.Seed.AuthDbSeeder;

namespace AuthService.Application.Navigation;

/// <summary>
/// The host's own sidebar rows — Dashboard, Approvals, Audit Logs, Setup.
/// <para>
/// Static rather than a table on purpose. Host navigation changes only when the host itself is
/// redeployed, so a table would add a migration and a seeding path for data that can never drift from
/// the code it describes. Being server-side still satisfies "the host hardcodes nothing": React
/// renders whatever this returns, and the same entitlement and permission gates apply to these rows
/// as to a remote's — which is how a host capability such as Maker-Checker can be sold as an add-on.
/// </para>
/// </summary>
public static class HostNavigationCatalog
{
    public sealed record Section(string Key, string Label, int Order);

    /// <param name="RequiredFeatureKey">Null means visible to every authenticated user.</param>
    /// <param name="RequiredCapability">Null means any capability on the feature is enough.</param>
    public sealed record Entry(
        string Key,
        string Label,
        string IconKey,
        string RoutePath,
        string SectionKey,
        int Order,
        string? RequiredFeatureKey,
        string? RequiredCapability);

    public const string AppsSectionKey = "apps";

    public static readonly IReadOnlyList<Section> Sections =
    [
        new("main", "Main", 10),
        new(AppsSectionKey, "Apps", 20),
        new("system", "System", 30),
        new("setup", "Setup", 40),
    ];

    public static readonly IReadOnlyList<Entry> Entries =
    [
        new("host.dashboard", "Dashboard", "Home", "/", "main", 10,
            HostFeatureKeys.Dashboard, "View"),

        new("host.system.approvals", "Approval Center", "UserCheck", "/system/approvals", "system", 10,
            HostFeatureKeys.SystemApprovals, "View"),

        // Deliberately ungated: every user can see the requests they themselves raised, and the
        // endpoint scopes to the caller server-side rather than relying on a permission.
        new("host.my-requests", "My Requests", "Clock", "/my-requests", "system", 20,
            null, null),

        new("host.system.audit-logs", "Audit Logs", "FileText", "/system/audit-logs", "system", 30,
            HostFeatureKeys.SystemAuditLogs, "View"),

        new("host.settings.users", "Users", "Users", "/settings/users", "setup", 10,
            HostFeatureKeys.SettingsUsers, "View"),

        new("host.settings.roles", "Roles", "Shield", "/settings/roles", "setup", 20,
            HostFeatureKeys.SettingsRoles, "View"),

        new("host.settings.applications", "Applications", "Grid", "/settings/applications", "setup", 30,
            HostFeatureKeys.SettingsApplications, "View"),

        new("host.system.checker-assignment", "Checker Assignment", "GitBranch", "/settings/checker-assignment", "setup", 40,
            HostFeatureKeys.SystemCheckerAssignment, "View"),

        new("host.settings.licensing", "Licensing", "Key", "/settings/licensing", "setup", 50,
            HostFeatureKeys.SettingsLicensing, "View"),
    ];
}
