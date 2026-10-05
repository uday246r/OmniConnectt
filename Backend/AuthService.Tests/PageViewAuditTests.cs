using AuthService.Application.DTOs;
using AuthService.Application.Navigation;
using AuthService.Application.Services;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Caching;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// Page views in the audit trail: a browser may say which route it opened, and nothing else.
/// </summary>
/// <remarks>
/// <para>
/// Page views were removed once already because the endpoint that wrote them let any signed-in user
/// write any application, module and action into the trail. They are back only on the condition that
/// the row cannot say anything the platform would not have said itself. These tests pin that
/// condition: labels come from the caller's own navigation tree, a page the caller cannot open is
/// refused, and a route that is not a page at all is refused before anything is looked up.
/// </para>
/// <para>
/// They also pin the two things that keep the most frequent row in the trail cheap: one row per person
/// per page inside the dedupe window, and no live "audit log changed" push for each one.
/// </para>
/// </remarks>
public class PageViewAuditTests : IDisposable
{
    private static readonly Guid Operator = Guid.NewGuid();
    private readonly AuthDbContext db = TestDb.Create("page-views");
    private readonly RecordingPublisher publisher = new();
    private readonly MemoryPlatformCache cache = new(new MemoryCache(new MemoryCacheOptions()));

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    // ── The resolver, against a hand-built tree ─────────────────────────────────────

    private static IReadOnlyList<NavSectionDto> Tree() =>
    [
        new("main", "Main", 10, false,
        [
            new("host.dashboard", "Dashboard", "Home", "/", null, 10, "host", "visible", null, null, []),
        ]),
        new("apps", "Apps", 20, false,
        [
            new("remote.lead", "Lead Management", "Layers", "/apps/lead", null, 10, "remote-app", "visible", null,
                new RemoteMountDto("lead", "http://x/mf-manifest.json", "lead_mf", "/apps/lead/view-lead"),
                [
                    new("remote.lead.lead#create-lead", "Create Lead", null, "/apps/lead/create-lead", "create-lead", 20, "submodule", "visible", null, null, []),
                ]),
        ]),
        new("system", "System", 30, true,
        [
            new("host.system.audit-logs", "Audit Logs", "FileText", "/system/audit-logs", null, 30, "host", "visible", null, null, []),
        ]),
    ];

    private static readonly HashSet<string> NoPermissions = [];

    [Fact]
    public void A_remote_page_is_named_by_its_app_and_its_sidebar_label()
    {
        var page = PageViewResolver.Resolve(Tree(), "/apps/lead/create-lead", NoPermissions, false);

        Assert.NotNull(page);
        Assert.Equal("Lead Management", page.Application);
        Assert.Equal("Create Lead", page.Module);
        Assert.Equal("create-lead", page.PageKey);
        Assert.Equal("Opened Lead Management → Create Lead.", page.Description);
    }

    [Fact]
    public void A_deep_link_inside_a_remote_page_is_recorded_against_that_page_with_its_full_path()
    {
        var page = PageViewResolver.Resolve(Tree(), "/apps/lead/create-lead/draft/42", NoPermissions, false);

        Assert.NotNull(page);
        Assert.Equal("Create Lead", page.Module);
        Assert.Equal("/apps/lead/create-lead/draft/42", page.Path);
    }

    [Fact]
    public void A_path_that_only_shares_a_prefix_with_a_page_is_not_that_page()
    {
        Assert.Null(PageViewResolver.Resolve(Tree(), "/apps/lead/create-leadership", NoPermissions, false));
    }

    [Fact]
    public void A_host_page_from_the_sidebar_is_named_by_its_row()
    {
        var page = PageViewResolver.Resolve(Tree(), "/system/audit-logs/", NoPermissions, false);

        Assert.NotNull(page);
        Assert.Equal("Host", page.Application);
        Assert.Equal("Audit Logs", page.Module);
        Assert.Equal("/system/audit-logs", page.Path);
    }

    [Fact]
    public void The_dashboard_root_resolves_to_the_dashboard()
    {
        var page = PageViewResolver.Resolve(Tree(), "/", NoPermissions, false);

        Assert.Equal("Opened Dashboard.", page?.Description);
    }

    [Theory]
    [InlineData("/apps/lead/delete-everything")]   // a page the remote does not have, or the caller cannot see
    [InlineData("/apps/payroll/salaries")]         // an app that is not in the caller's tree
    [InlineData("/system/system-logs")]            // a host page the caller's tree omits
    [InlineData("/settings/users")]                // needs Users:View, which the caller lacks
    public void A_page_outside_the_callers_own_tree_is_refused(string path)
    {
        Assert.Null(PageViewResolver.Resolve(Tree(), path, NoPermissions, false));
    }

    [Theory]
    [InlineData("https://evil.example/apps/lead")]
    [InlineData("/apps/lead/../../system/audit-logs")]
    [InlineData("/apps/lead/create-lead?x=1")]
    [InlineData("//apps/lead")]
    [InlineData("")]
    [InlineData(null)]
    public void Something_that_is_not_a_route_is_refused(string? path)
    {
        Assert.Null(PageViewResolver.Normalize(path));
    }

    [Fact]
    public void A_route_longer_than_any_real_page_is_refused()
    {
        Assert.Null(PageViewResolver.Normalize("/" + new string('a', PageViewResolver.MaxPathLength)));
    }

    [Fact]
    public void Host_pages_reached_outside_the_sidebar_follow_the_same_permission_as_their_route()
    {
        var granted = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "host.settings.roles:View" };

        Assert.Equal("Roles", PageViewResolver.Resolve(Tree(), "/settings/roles", granted, false)?.Module);
        Assert.Null(PageViewResolver.Resolve(Tree(), "/settings/applications", granted, false));
        Assert.Equal("My Profile", PageViewResolver.Resolve(Tree(), "/profile", NoPermissions, false)?.Module);
        Assert.NotNull(PageViewResolver.Resolve(Tree(), "/settings/applications", NoPermissions, isAdministrator: true));
    }

    [Fact]
    public void A_user_profile_carries_the_user_so_the_view_appears_on_their_own_audit_tab()
    {
        var id = Guid.NewGuid();
        var granted = new HashSet<string> { "host.settings.users:View" };

        var page = PageViewResolver.Resolve(Tree(), $"/settings/users/{id}", granted, false);

        Assert.Equal(id, page?.UserId);
        Assert.Null(PageViewResolver.Resolve(Tree(), "/settings/users/new", granted, false));
    }

    // ── The service, against a real catalog ───────────────────────────────────────

    private async Task SeedCatalogAsync()
    {
        db.NavSections.AddRange(
            new NavSection { Key = "main", Label = "Main", SortOrder = 10 },
            new NavSection { Key = "apps", Label = "Apps", SortOrder = 20 });
        db.HostNavItems.Add(new HostNavItem
        {
            Id = Guid.NewGuid(), Key = "host.dashboard", Label = "Dashboard", RoutePath = "/", SectionKey = "main",
            SortOrder = 10, RequiredFeatureKey = "host.dashboard", RequiredCapability = "View",
        });

        var app = new PermissionFeature { Id = Guid.NewGuid(), Key = "remote.lead", DisplayName = "Lead Management", SortOrder = 10 };
        var module = new PermissionFeature { Id = Guid.NewGuid(), Key = "remote.lead.lead", DisplayName = "Leads", SortOrder = 20, ParentFeatureId = app.Id };
        db.PermissionFeatures.AddRange(app, module);
        db.FeatureNavItems.Add(new FeatureNavItem
        {
            Id = Guid.NewGuid(), FeatureId = module.Id, NavKey = "create-lead", Label = "Create Lead",
            RouteSegment = "create-lead", SortOrder = 20, RequiredCapability = "Create",
        });
        db.RemoteApps.Add(new RemoteApp
        {
            FeatureId = app.Id, Key = "lead", ManifestUrl = "http://localhost:5002/mf-manifest.json", Status = RemoteAppStatus.Active,
        });
        await db.SaveChangesAsync();
    }

    private PageViewAuditService Service() =>
        new(new NavigationAppService(db, cache), TestAudit.For(db, publisher), cache, db);

    private static readonly HashSet<string> LeadMaker = new(StringComparer.OrdinalIgnoreCase) { "remote.lead.lead:Create" };

    [Fact]
    public async Task Opening_a_page_writes_one_plain_language_row_attributed_from_the_token()
    {
        await SeedCatalogAsync();

        var outcome = await Service().RecordAsync(Operator, "Asha Rao", LeadMaker, false, "/apps/lead/create-lead", "10.0.0.5", "Firefox");

        Assert.Equal(PageViewOutcome.Recorded, outcome);
        var row = await db.AuditLogs.SingleAsync();
        Assert.Equal("page.viewed", row.Action);
        Assert.Equal(Operator, row.ActorUserId);
        Assert.Equal("Asha Rao", row.ActorName);
        Assert.Equal("Lead Management", row.SourceApplication);
        Assert.Equal("Remote", row.HostOrRemote);
        Assert.Equal("Create Lead", row.Module);
        Assert.Equal("Navigation", row.ActionCategory);
        Assert.Equal("Opened Lead Management → Create Lead.", row.Details);
    }

    [Fact]
    public async Task A_page_the_caller_cannot_open_writes_nothing()
    {
        await SeedCatalogAsync();

        var outcome = await Service().RecordAsync(Operator, "Asha Rao", NoPermissions, false, "/apps/lead/create-lead", null, null);

        Assert.Equal(PageViewOutcome.Refused, outcome);
        Assert.Empty(db.AuditLogs);
    }

    [Fact]
    public async Task Opening_the_same_page_again_within_the_window_is_not_a_second_row()
    {
        await SeedCatalogAsync();
        var service = Service();

        await service.RecordAsync(Operator, "Asha Rao", LeadMaker, false, "/apps/lead/create-lead", null, null);
        var second = await service.RecordAsync(Operator, "Asha Rao", LeadMaker, false, "/APPS/lead/create-lead/", null, null);
        var otherUser = await service.RecordAsync(Guid.NewGuid(), "Ben Ito", LeadMaker, false, "/apps/lead/create-lead", null, null);

        Assert.Equal(PageViewOutcome.Duplicate, second);
        Assert.Equal(PageViewOutcome.Recorded, otherUser);
        Assert.Equal(2, await db.AuditLogs.CountAsync());
    }

    [Fact]
    public async Task A_page_view_does_not_push_a_live_refresh_to_audit_screens()
    {
        await SeedCatalogAsync();

        await Service().RecordAsync(Operator, "Asha Rao", LeadMaker, false, "/apps/lead/create-lead", null, null);

        Assert.Empty(publisher.AuditViewerEvents);
        Assert.Equal(0, publisher.KpiRefreshRequests);
    }

    [Fact]
    public async Task Opening_a_user_profile_names_that_user_and_is_recorded_about_them()
    {
        await SeedCatalogAsync();
        var viewed = new User { Id = Guid.NewGuid(), Name = "Priya Nair", Email = "priya@example.com" };
        db.Users.Add(viewed);
        await db.SaveChangesAsync();
        var usersViewer = new HashSet<string> { "host.settings.users:View" };

        await Service().RecordAsync(Operator, "Asha Rao", usersViewer, false, $"/settings/users/{viewed.Id}", null, null);

        var row = await db.AuditLogs.SingleAsync();
        Assert.Equal("User", row.EntityType);
        Assert.Equal(viewed.Id.ToString(), row.EntityId);
        Assert.Equal("Opened the profile of Priya Nair.", row.Details);
        Assert.Equal("Host", row.SourceApplication);
    }
}
