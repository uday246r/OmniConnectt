using AuthService.Application.DTOs;
using AuthService.Application.Entitlements;
using AuthService.Application.Navigation;
using AuthService.Domain.Enums;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// The sidebar's precedence rules. Getting these wrong either hides something a customer paid for or
/// advertises the existence of something they should never learn about, so each gate gets a case.
/// </summary>
public class NavigationTreeBuilderTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 3, 12, 0, 0, TimeSpan.Zero);

    // ── Fixture ──────────────────────────────────────────────────────────────────
    // One app (remote.lead) with one module (remote.lead.lead) carrying TWO nav rows over a single
    // feature — the View Leads / Create Lead case that a one-row-per-module design would have lost.

    private static NavigationCatalogSnapshot Catalog(string appStatus = "Active", string? maintenanceMessage = null)
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
            });

    private static Dictionary<string, EntitlementEntry> Entitlements(params EntitlementEntry[] entries)
        => entries.ToDictionary(e => e.FeatureKey, StringComparer.OrdinalIgnoreCase);

    private static EntitlementEntry Entry(
        string key,
        EntitlementStatus status = EntitlementStatus.Licensed,
        EntitlementVisibility visibility = EntitlementVisibility.Normal,
        string? lockReason = null)
        => new(key, status, visibility, null, lockReason, null);

    private static HashSet<string> Perms(params string[] p) => p.ToHashSet(StringComparer.OrdinalIgnoreCase);

    private static NavNodeDto? App(IReadOnlyList<NavSectionDto> tree) =>
        tree.FirstOrDefault(s => s.Key == "apps")?.Items.FirstOrDefault(i => i.Key == "remote.lead");

    // ── The one-feature-many-rows case ───────────────────────────────────────────

    [Fact]
    public void Two_nav_rows_over_one_feature_both_survive()
    {
        // The regression this whole design exists to prevent. View Leads and Create Lead are the same
        // remote.lead.lead feature; a tree keyed one-row-per-feature silently drops Create Lead.
        var tree = NavigationTreeBuilder.Build(
            Catalog(), Entitlements(),
            Perms("remote.lead.lead:View", "remote.lead.lead:Create"),
            isAdministrator: false, Now);

        var labels = App(tree)!.Children.Select(c => c.Label).ToList();

        Assert.Contains("View Leads", labels);
        Assert.Contains("Create Lead", labels);
    }

    [Fact]
    public void A_row_is_hidden_when_its_specific_capability_is_missing()
    {
        // Holding View on the module must not reveal the Create page.
        var tree = NavigationTreeBuilder.Build(
            Catalog(), Entitlements(), Perms("remote.lead.lead:View"), isAdministrator: false, Now);

        var labels = App(tree)!.Children.Select(c => c.Label).ToList();

        Assert.Contains("View Leads", labels);
        Assert.DoesNotContain("Create Lead", labels);
    }

    [Fact]
    public void Sibling_rows_over_one_feature_get_distinct_keys()
    {
        var tree = NavigationTreeBuilder.Build(
            Catalog(), Entitlements(),
            Perms("remote.lead.lead:View", "remote.lead.lead:Create"),
            isAdministrator: false, Now);

        var keys = App(tree)!.Children.Select(c => c.Key).ToList();

        Assert.Equal(keys.Count, keys.Distinct().Count());
    }

    // ── Routes ───────────────────────────────────────────────────────────────────

    [Fact]
    public void Submodule_routes_are_refresh_safe_absolute_paths()
    {
        var tree = NavigationTreeBuilder.Build(
            Catalog(), Entitlements(), Perms("remote.lead.lead:View"), isAdministrator: false, Now);

        var row = App(tree)!.Children.Single();

        Assert.Equal("/apps/lead/view-lead", row.RoutePath);
        Assert.Equal("view-lead", row.Page);
    }

    [Fact]
    public void The_app_row_advertises_where_to_land_and_how_to_mount()
    {
        var tree = NavigationTreeBuilder.Build(
            Catalog(), Entitlements(), Perms("remote.lead.lead:View"), isAdministrator: false, Now);

        var app = App(tree)!;

        Assert.Equal("/apps/lead", app.RoutePath);
        Assert.Null(app.Page);
        Assert.Equal("lead_mf", app.Remote!.ContainerName);
        // Never a blank frame: /apps/lead redirects to the first row the caller can actually see.
        Assert.Equal("/apps/lead/view-lead", app.Remote.DefaultRoutePath);
    }

    // ── Gate 6, the catalogue leak ───────────────────────────────────────────────

    [Fact]
    public void Unlicensed_and_no_permission_is_omitted_not_locked()
    {
        // The leak case. Rendering a locked upsell row here would tell every junior user exactly which
        // modules the product contains.
        var tree = NavigationTreeBuilder.Build(
            Catalog(),
            Entitlements(Entry("remote.lead", EntitlementStatus.Unlicensed, lockReason: "Not in your plan.")),
            Perms(),
            isAdministrator: false, Now);

        Assert.Null(App(tree));
    }

    [Fact]
    public void Unlicensed_but_permitted_is_shown_locked_with_a_reason()
    {
        var tree = NavigationTreeBuilder.Build(
            Catalog(),
            Entitlements(Entry("remote.lead", EntitlementStatus.Unlicensed, lockReason: "Not in your plan.")),
            Perms("remote.lead.lead:View"),
            isAdministrator: false, Now);

        var app = App(tree)!;

        Assert.Equal("locked", app.State);
        Assert.Equal("Not in your plan.", app.LockReason);
        // A locked parent cannot contain a usable page.
        Assert.All(app.Children, c => Assert.Equal("locked", c.State));
    }

    // ── Gates 1-5 ────────────────────────────────────────────────────────────────

    [Fact]
    public void A_disabled_app_is_omitted_entirely()
    {
        var tree = NavigationTreeBuilder.Build(
            Catalog(appStatus: "Disabled"), Entitlements(),
            Perms("remote.lead.lead:View"), isAdministrator: false, Now);

        Assert.Null(App(tree));
    }

    [Fact]
    public void An_app_under_maintenance_is_shown_with_its_message()
    {
        var tree = NavigationTreeBuilder.Build(
            Catalog(appStatus: "Maintenance", maintenanceMessage: "Back at 09:00."), Entitlements(),
            Perms("remote.lead.lead:View"), isAdministrator: false, Now);

        var app = App(tree)!;

        Assert.Equal("maintenance", app.State);
        Assert.Equal("Back at 09:00.", app.MaintenanceMessage);
    }

    [Fact]
    public void Locked_beats_maintenance()
    {
        // An unlicensed module that also happens to be under maintenance is, first and foremost,
        // unlicensed — telling the user to come back at 09:00 would be a lie.
        var tree = NavigationTreeBuilder.Build(
            Catalog(appStatus: "Maintenance", maintenanceMessage: "Back at 09:00."),
            Entitlements(Entry("remote.lead", EntitlementStatus.Unlicensed)),
            Perms("remote.lead.lead:View"), isAdministrator: false, Now);

        Assert.Equal("locked", App(tree)!.State);
    }

    [Fact]
    public void A_hidden_entitlement_omits_rather_than_locks()
    {
        var tree = NavigationTreeBuilder.Build(
            Catalog(),
            Entitlements(Entry("remote.lead", EntitlementStatus.Licensed, EntitlementVisibility.Hidden)),
            Perms("remote.lead.lead:View"), isAdministrator: false, Now);

        Assert.Null(App(tree));
    }

    [Fact]
    public void An_app_with_no_render_metadata_is_omitted()
    {
        // Half-synced: the permission features arrived but the registry never pushed the manifest, so
        // there is nothing to mount and a row would only ever 404.
        var catalog = Catalog() with { RenderByFeatureKey = new Dictionary<string, NavRenderMetadata>() };

        var tree = NavigationTreeBuilder.Build(
            catalog, Entitlements(), Perms("remote.lead.lead:View"), isAdministrator: false, Now);

        Assert.Null(App(tree));
    }

    [Fact]
    public void A_module_licensed_separately_from_its_app_locks_alone()
    {
        var tree = NavigationTreeBuilder.Build(
            Catalog(),
            Entitlements(Entry("remote.lead.fieldsettings", EntitlementStatus.Unlicensed, lockReason: "Add-on.")),
            Perms("remote.lead.lead:View", "remote.lead.fieldsettings:Manage"),
            isAdministrator: false, Now);

        var children = App(tree)!.Children;

        Assert.Equal("visible", children.Single(c => c.Label == "View Leads").State);
        Assert.Equal("locked", children.Single(c => c.Label == "Field Settings").State);
    }

    // ── Permission edges ─────────────────────────────────────────────────────────

    [Fact]
    public void An_app_with_no_visible_children_and_no_direct_permission_is_omitted()
    {
        var tree = NavigationTreeBuilder.Build(
            Catalog(), Entitlements(), Perms("remote.other:View"), isAdministrator: false, Now);

        Assert.Null(App(tree));
    }

    [Fact]
    public void An_app_survives_on_a_direct_capability_with_no_children()
    {
        // Sub-module permissions are keyed "remote.lead.lead:View", which does not start with
        // "remote.lead:" — so the app row needs both prefix forms checked or it vanishes for most users.
        var tree = NavigationTreeBuilder.Build(
            Catalog(), Entitlements(), Perms("remote.lead:View"), isAdministrator: false, Now);

        var app = App(tree)!;

        Assert.NotNull(app);
        Assert.Empty(app.Children);
    }

    [Fact]
    public void An_administrator_sees_every_row_without_holding_any_permission()
    {
        var tree = NavigationTreeBuilder.Build(
            Catalog(), Entitlements(), Perms(), isAdministrator: true, Now);

        Assert.Equal(3, App(tree)!.Children.Count);
    }

    [Fact]
    public void An_administrator_does_not_bypass_licensing()
    {
        // Being the most privileged user says nothing about what the deployment bought.
        var tree = NavigationTreeBuilder.Build(
            Catalog(),
            Entitlements(Entry("remote.lead", EntitlementStatus.Unlicensed)),
            Perms(), isAdministrator: true, Now);

        Assert.Equal("locked", App(tree)!.State);
    }

    // ── Host rows and sections ───────────────────────────────────────────────────

    [Fact]
    public void Host_rows_are_permission_filtered_too()
    {
        var tree = NavigationTreeBuilder.Build(
            Catalog(), Entitlements(), Perms("host.dashboard:View"), isAdministrator: false, Now);

        var main = tree.Single(s => s.Key == "main");

        Assert.Equal("Dashboard", main.Items.Single().Label);
        // Setup rows need their own capabilities, which this user has none of.
        Assert.DoesNotContain(tree, s => s.Key == "setup");
    }

    [Fact]
    public void An_ungated_host_row_is_visible_to_everyone()
    {
        var tree = NavigationTreeBuilder.Build(
            Catalog(), Entitlements(), Perms(), isAdministrator: false, Now);

        var system = tree.Single(s => s.Key == "system");

        Assert.Equal("My Requests", system.Items.Single().Label);
    }

    [Fact]
    public void Empty_sections_are_dropped_rather_than_rendered_as_bare_headings()
    {
        var tree = NavigationTreeBuilder.Build(
            Catalog(), Entitlements(), Perms(), isAdministrator: false, Now);

        Assert.All(tree, s => Assert.NotEmpty(s.Items));
    }

    [Fact]
    public void Children_are_never_null_so_the_host_never_branches()
    {
        var tree = NavigationTreeBuilder.Build(
            Catalog(), Entitlements(), Perms(), isAdministrator: true, Now);

        foreach (var node in tree.SelectMany(s => s.Items))
        {
            Assert.NotNull(node.Children);
            Assert.All(node.Children, c => Assert.NotNull(c.Children));
        }
    }
}
