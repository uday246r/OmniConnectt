using AuthService.Application.DTOs;
using AuthService.Application.Navigation;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// The sidebar's filtering rules. Getting these wrong either hides something a user is entitled to
/// see or advertises the existence of something they are not, so each gate gets a case.
/// </summary>
public class NavigationTreeBuilderTests
{
    // ── Fixture ──────────────────────────────────────────────────────────────────
    // Sections and host rows are seeded DATA now, not a compiled-in list, so the tests supply them
    // the same way the database does. One app (remote.lead) with one module (remote.lead.lead)
    // carrying TWO nav rows over a single feature — the View Leads / Create Lead case that a
    // one-row-per-module design would have lost.

    private static IReadOnlyList<NavSectionRow> Sections() =>
    [
        new("main", "Main", 10, false),
        new("apps", "Apps", 20, false),
        new("system", "System", 30, true),
    ];

    private static IReadOnlyList<HostNavRow> HostRows() =>
    [
        new("host.dashboard", "Dashboard", "Home", "/", "main", 10, "host.dashboard", "View"),
        new("host.system.audit-logs", "Audit Logs", "FileText", "/system/audit-logs", "system", 30, "host.system.audit-logs", "View"),
        // Ungated: no feature key at all.
        new("host.my-requests", "My Requests", "Clock", "/my-requests", "system", 20, null, null),
    ];

    private static NavigationCatalogSnapshot Catalog(
        string appStatus = "Active",
        string? maintenanceMessage = null,
        IReadOnlyList<NavSectionRow>? sections = null,
        IReadOnlyList<HostNavRow>? hostRows = null)
        => new(
            Features:
            [
                new("remote.lead", "Lead Management", 10, null, true, ["View"]),
                new("remote.lead.lead", "Leads", 20, "remote.lead", true, ["View", "Create"]),
                new("remote.lead.fieldsettings", "Field Settings", 40, "remote.lead", true, ["Manage"]),
            ],
            NavItemsByFeatureKey: new Dictionary<string, IReadOnlyList<NavItemRow>>(StringComparer.OrdinalIgnoreCase)
            {
                ["remote.lead.lead"] =
                [
                    new("view-lead", "View Leads", "Users", "view-lead", 10, "View"),
                    new("create-lead", "Create Lead", "UserPlus", "create-lead", 20, "Create"),
                ],
                ["remote.lead.fieldsettings"] =
                [
                    new("field-settings", "Field Settings", "Settings", "field-settings", 10, "Manage"),
                ],
            },
            RenderByFeatureKey: new Dictionary<string, NavRenderMetadata>(StringComparer.OrdinalIgnoreCase)
            {
                ["remote.lead"] = new("Layers", "http://localhost:5002/mf-manifest.json", "lead_mf", appStatus, maintenanceMessage),
            },
            Sections: sections ?? Sections(),
            HostItems: hostRows ?? HostRows());

    private static HashSet<string> Perms(params string[] p) => p.ToHashSet(StringComparer.OrdinalIgnoreCase);

    private static NavNodeDto? App(IReadOnlyList<NavSectionDto> tree) =>
        tree.FirstOrDefault(s => s.Key == "apps")?.Items.FirstOrDefault(i => i.Key == "remote.lead");

    // ── The one-feature-many-rows case ───────────────────────────────────────────

    [Fact]
    public void Two_nav_rows_over_one_feature_both_survive()
    {
        // The regression this design exists to prevent. View Leads and Create Lead are the same
        // remote.lead.lead feature; a tree keyed one-row-per-feature silently drops Create Lead.
        var tree = NavigationTreeBuilder.Build(
            Catalog(), Perms("remote.lead.lead:View", "remote.lead.lead:Create"), isAdministrator: false);

        var labels = App(tree)!.Children.Select(c => c.Label).ToList();

        Assert.Contains("View Leads", labels);
        Assert.Contains("Create Lead", labels);
    }

    [Fact]
    public void A_row_is_hidden_when_its_specific_capability_is_missing()
    {
        var tree = NavigationTreeBuilder.Build(Catalog(), Perms("remote.lead.lead:View"), isAdministrator: false);

        var labels = App(tree)!.Children.Select(c => c.Label).ToList();

        Assert.Contains("View Leads", labels);
        Assert.DoesNotContain("Create Lead", labels);
    }

    [Fact]
    public void Sibling_rows_over_one_feature_get_distinct_keys()
    {
        var tree = NavigationTreeBuilder.Build(
            Catalog(), Perms("remote.lead.lead:View", "remote.lead.lead:Create"), isAdministrator: false);

        var keys = App(tree)!.Children.Select(c => c.Key).ToList();

        Assert.Equal(keys.Count, keys.Distinct().Count());
    }

    // ── Routes ───────────────────────────────────────────────────────────────────

    [Fact]
    public void Submodule_routes_are_refresh_safe_absolute_paths()
    {
        var tree = NavigationTreeBuilder.Build(Catalog(), Perms("remote.lead.lead:View"), isAdministrator: false);

        var row = App(tree)!.Children.Single();

        Assert.Equal("/apps/lead/view-lead", row.RoutePath);
        Assert.Equal("view-lead", row.Page);
    }

    [Fact]
    public void The_app_row_advertises_where_to_land_and_how_to_mount()
    {
        var tree = NavigationTreeBuilder.Build(Catalog(), Perms("remote.lead.lead:View"), isAdministrator: false);

        var app = App(tree)!;

        Assert.Equal("/apps/lead", app.RoutePath);
        Assert.Null(app.Page);
        Assert.Equal("lead_mf", app.Remote!.ContainerName);
        // Never a blank frame: /apps/lead redirects to the first row the caller can actually see.
        Assert.Equal("/apps/lead/view-lead", app.Remote.DefaultRoutePath);
    }

    // ── Registration, status and maintenance ─────────────────────────────────────

    [Fact]
    public void A_disabled_app_is_omitted_entirely()
    {
        var tree = NavigationTreeBuilder.Build(
            Catalog(appStatus: "Disabled"), Perms("remote.lead.lead:View"), isAdministrator: false);

        Assert.Null(App(tree));
    }

    [Fact]
    public void An_app_under_maintenance_is_shown_with_its_message()
    {
        var tree = NavigationTreeBuilder.Build(
            Catalog(appStatus: "Maintenance", maintenanceMessage: "Back at 09:00."),
            Perms("remote.lead.lead:View"), isAdministrator: false);

        var app = App(tree)!;

        Assert.Equal("maintenance", app.State);
        Assert.Equal("Back at 09:00.", app.MaintenanceMessage);
        // Children inherit it, so a sub-page cannot look usable while its app is down.
        Assert.All(app.Children, c => Assert.Equal("maintenance", c.State));
    }

    [Fact]
    public void An_app_with_no_render_metadata_is_omitted()
    {
        // Half-synced: the permission features arrived but the registry never pushed the manifest, so
        // there is nothing to mount and a row would only ever 404.
        var catalog = Catalog() with { RenderByFeatureKey = new Dictionary<string, NavRenderMetadata>() };

        var tree = NavigationTreeBuilder.Build(catalog, Perms("remote.lead.lead:View"), isAdministrator: false);

        Assert.Null(App(tree));
    }

    // ── Permission edges ─────────────────────────────────────────────────────────

    [Fact]
    public void An_app_with_no_visible_children_and_no_direct_permission_is_omitted()
    {
        var tree = NavigationTreeBuilder.Build(Catalog(), Perms("remote.other:View"), isAdministrator: false);

        Assert.Null(App(tree));
    }

    [Fact]
    public void An_app_survives_on_a_direct_capability_with_no_children()
    {
        // Sub-module permissions are keyed "remote.lead.lead:View", which does not start with
        // "remote.lead:" — so the app row needs both prefix forms checked or it vanishes for most users.
        var tree = NavigationTreeBuilder.Build(Catalog(), Perms("remote.lead:View"), isAdministrator: false);

        var app = App(tree)!;

        Assert.NotNull(app);
        Assert.Empty(app.Children);
    }

    [Fact]
    public void An_administrator_sees_every_row_without_holding_any_permission()
    {
        var tree = NavigationTreeBuilder.Build(Catalog(), Perms(), isAdministrator: true);

        Assert.Equal(3, App(tree)!.Children.Count);
    }

    // ── Host rows, now seeded data rather than a compiled-in list ────────────────

    [Fact]
    public void Host_rows_come_from_the_data_and_are_permission_filtered()
    {
        var tree = NavigationTreeBuilder.Build(Catalog(), Perms("host.dashboard:View"), isAdministrator: false);

        var main = tree.Single(s => s.Key == "main");

        Assert.Equal("Dashboard", main.Items.Single().Label);
    }

    [Fact]
    public void An_ungated_host_row_is_visible_to_everyone()
    {
        var tree = NavigationTreeBuilder.Build(Catalog(), Perms(), isAdministrator: false);

        var system = tree.Single(s => s.Key == "system");

        Assert.Equal("My Requests", system.Items.Single().Label);
    }

    [Fact]
    public void Renaming_a_section_or_row_needs_no_code_change()
    {
        // The point of moving navigation into the database: labels, order and pinning are data.
        var tree = NavigationTreeBuilder.Build(
            Catalog(
                sections: [new("ops", "Operations", 5, true)],
                hostRows: [new("host.my-requests", "Requests I Raised", "Clock", "/my-requests", "ops", 10, null, null)]),
            Perms(), isAdministrator: false);

        var section = tree.Single();

        Assert.Equal("Operations", section.Label);
        Assert.True(section.PinToBottom);
        Assert.Equal("Requests I Raised", section.Items.Single().Label);
    }

    [Fact]
    public void A_row_pointing_at_a_section_that_does_not_exist_is_dropped_not_fatal()
    {
        // Bad data must cost one row, not the whole sidebar for everyone.
        var tree = NavigationTreeBuilder.Build(
            Catalog(hostRows: [new("orphan", "Orphan", null, "/orphan", "no-such-section", 10, null, null)]),
            Perms(), isAdministrator: true);

        Assert.DoesNotContain(tree.SelectMany(s => s.Items), n => n.Key == "orphan");
    }

    // ── Sections ─────────────────────────────────────────────────────────────────

    [Fact]
    public void There_is_no_setup_section()
    {
        // Users, Roles, Applications and Checker Assignment live behind the Topbar gear. Having them
        // in the sidebar too made one destination reachable two ways.
        var tree = NavigationTreeBuilder.Build(Catalog(), Perms(), isAdministrator: true);

        Assert.DoesNotContain(tree, s => s.Key == "setup");
        Assert.DoesNotContain(tree.SelectMany(s => s.Items), n => n.RoutePath.StartsWith("/settings/"));
    }

    [Fact]
    public void Empty_sections_are_dropped_rather_than_rendered_as_bare_headings()
    {
        var tree = NavigationTreeBuilder.Build(Catalog(), Perms(), isAdministrator: false);

        Assert.All(tree, s => Assert.NotEmpty(s.Items));
    }

    [Fact]
    public void Pinned_sections_sort_after_unpinned_ones()
    {
        var tree = NavigationTreeBuilder.Build(Catalog(), Perms(), isAdministrator: true);

        var pinnedIndex = tree.ToList().FindIndex(s => s.PinToBottom);
        Assert.Equal(tree.Count - 1, pinnedIndex);
    }

    [Fact]
    public void Children_are_never_null_so_the_host_never_branches()
    {
        var tree = NavigationTreeBuilder.Build(Catalog(), Perms(), isAdministrator: true);

        foreach (var node in tree.SelectMany(s => s.Items))
        {
            Assert.NotNull(node.Children);
            Assert.All(node.Children, c => Assert.NotNull(c.Children));
        }
    }
}
