using AuthService.Application.Remotes;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// Regrouping a remote's flat discovery result into the nested feature/module shape the permission
/// catalog stores.
/// </summary>
/// <remarks>
/// Pure, and now directly callable — it used to be a private method on the registry's outbound HTTP
/// client, where exercising it meant standing up a fake server and reading the JSON it posted. The
/// grouping carries the null-versus-empty navigation rule, which is the part that decides whether an
/// unreachable remote keeps its sidebar or loses it, so it deserves assertions of its own rather than
/// coverage as a side effect of an integration test.
/// </remarks>
public class RemoteFeatureRequestBuilderTests
{
    private static RemoteCapability Root(string key) => new(string.Empty, string.Empty, key, key);

    private static RemoteCapability InModule(string moduleKey, string moduleName, string key) =>
        new(moduleKey, moduleName, key, key);

    [Fact]
    public void Capabilities_with_no_module_hang_directly_off_the_feature()
    {
        var request = RemoteFeatureRequestBuilder.Build(
            "remote.lead", "Lead Management", 20, [Root("View"), Root("Create")]);

        Assert.Equal(2, request.Capabilities!.Count);
        Assert.Empty(request.Modules!);
    }

    [Fact]
    public void Capabilities_sharing_a_module_are_grouped_into_one_child_feature()
    {
        var request = RemoteFeatureRequestBuilder.Build(
            "remote.lead", "Lead Management", 20,
            [InModule("Lead", "Leads", "View"), InModule("Lead", "Leads", "Create"), InModule("AuditLog", "Audit Logs", "View")]);

        Assert.Equal(2, request.Modules!.Count);
        Assert.Equal(2, request.Modules.Single(m => m.Key == "Lead").Capabilities.Count);
        Assert.Empty(request.Capabilities!);
    }

    [Fact]
    public void A_remote_that_reported_no_navigation_at_all_leaves_every_module_nav_null()
    {
        var request = RemoteFeatureRequestBuilder.Build(
            "remote.lead", "Lead Management", 20, [InModule("Lead", "Leads", "View")], nav: null);

        // Null propagates per module, so the catalog keeps the rows it already holds. An older remote,
        // or one briefly unreachable, must not empty a working sidebar.
        Assert.Null(Assert.Single(request.Modules!).Nav);
    }

    [Fact]
    public void A_module_the_remote_described_with_no_rows_gets_an_empty_nav_list_not_a_null_one()
    {
        var request = RemoteFeatureRequestBuilder.Build(
            "remote.lead", "Lead Management", 20,
            [InModule("Lead", "Leads", "View"), InModule("MasterData", "Master Data", "View")],
            nav: [new RemoteNavItem("Lead", "view-lead", "View Leads", "Users", "view-lead", 10, "View")]);

        // The remote DID report navigation — just none for this module. That is a real answer:
        // MasterData is grantable but contributes no sidebar row, and any row it previously had
        // should be cleared.
        Assert.Empty(request.Modules!.Single(m => m.Key == "MasterData").Nav!);
        Assert.Single(request.Modules!.Single(m => m.Key == "Lead").Nav!);
    }

    [Fact]
    public void Navigation_rows_come_back_in_the_order_the_remote_asked_for()
    {
        var request = RemoteFeatureRequestBuilder.Build(
            "remote.lead", "Lead Management", 20,
            [InModule("Lead", "Leads", "View")],
            nav:
            [
                new RemoteNavItem("Lead", "create-lead", "Create Lead", null, "create-lead", 20, "Create"),
                new RemoteNavItem("Lead", "view-lead", "View Leads", null, "view-lead", 10, "View"),
            ]);

        var rows = Assert.Single(request.Modules!).Nav!;

        Assert.Equal(["view-lead", "create-lead"], rows.Select(r => r.Key));
    }

    [Fact]
    public void A_remote_that_could_not_be_read_produces_a_request_that_asserts_nothing()
    {
        var request = RemoteFeatureRequestBuilder.Build("remote.lead", "Lead Management", 20, capabilities: null);

        // Both halves null. This is what carries "keep the stored set" all the way from the discovery
        // client to the catalog without any component in between having to know why.
        Assert.Null(request.Capabilities);
        Assert.Null(request.Modules);

        // The identity fields still travel, so a display-name or position change applies even while
        // the remote itself is unreachable.
        Assert.Equal("remote.lead", request.Key);
        Assert.Equal("Lead Management", request.DisplayName);
        Assert.Equal(20, request.SortOrder);
    }

    [Fact]
    public void A_capability_type_survives_the_regrouping()
    {
        var request = RemoteFeatureRequestBuilder.Build(
            "remote.lead", "Lead Management", 20,
            [new RemoteCapability("Dashboard", "Dashboard", "kpi.total-leads", "Total Leads", "Headline count", "Widget")]);

        var capability = Assert.Single(Assert.Single(request.Modules!).Capabilities);

        Assert.Equal("Widget", capability.Type);
        Assert.Equal("Headline count", capability.Description);
    }
}
