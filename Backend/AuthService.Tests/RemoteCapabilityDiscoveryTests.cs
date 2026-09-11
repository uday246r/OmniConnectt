using System.Net;
using System.Text;
using AuthService.Infrastructure.Remotes;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// The ladder that reads a remote app's own <c>GET /permissions</c>, across all four contract
/// versions it has to keep working with.
/// </summary>
/// <remarks>
/// <para>
/// This code moved from the retired Module Registry, where it had no tests at all — the only way to
/// reach it was through a live HTTP call to a real remote. It is worth covering carefully because it
/// sits directly upstream of authorization: whatever it returns becomes the capability set the
/// permission catalog reconciles against, and reconciling against a wrong answer deactivates real
/// grants.
/// </para>
/// <para>
/// The single most important behaviour here is the one that looks like an omission: <b>every failure
/// answers null, and null is not an empty list</b>. Null means "the remote said nothing", which the
/// catalog treats as "keep what is stored". An empty list means "the remote declares nothing", which
/// deactivates. Collapse the two and a remote restarting mid-deploy revokes every permission it
/// grants.
/// </para>
/// </remarks>
public class RemoteCapabilityDiscoveryTests
{
    /// <summary>Answers one canned response, so a test can state exactly what the remote said.</summary>
    private sealed class StubHandler(HttpStatusCode status, string body) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(new HttpResponseMessage(status)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            });
    }

    private sealed class ThrowingHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            throw new HttpRequestException("Connection refused");
    }

    private static RemoteCapabilityDiscoveryClient Client(HttpMessageHandler handler) =>
        new(new HttpClient(handler), NullLogger<RemoteCapabilityDiscoveryClient>.Instance);

    private static RemoteCapabilityDiscoveryClient Responding(string body, HttpStatusCode status = HttpStatusCode.OK) =>
        Client(new StubHandler(status, body));

    // ── v1: the flat contract ────────────────────────────────────────────────────

    [Fact]
    public async Task A_flat_v1_response_is_read_as_one_implicit_module()
    {
        var client = Responding("""
            { "capabilities": [ { "key": "View", "displayName": "View" },
                                { "key": "Create", "displayName": "Create" } ] }
            """);

        var result = await client.FetchAsync("http://remote/permissions");

        Assert.NotNull(result);
        Assert.Equal(2, result.Capabilities.Count);

        // Empty module key means the capability hangs directly off the app's own feature rather than
        // a sub-module — which is exactly what a v1 remote has always meant.
        Assert.All(result.Capabilities, c => Assert.Equal(string.Empty, c.ModuleKey));
    }

    [Fact]
    public async Task A_flat_v1_response_states_no_opinion_about_navigation()
    {
        var client = Responding("""{ "capabilities": [ { "key": "View", "displayName": "View" } ] }""");

        var result = await client.FetchAsync("http://remote/permissions");

        // Null, not empty. A v1 remote predates navigation entirely, so the sidebar rows already
        // stored for it must survive — an empty list would clear them and leave the app unreachable
        // from the sidebar it used to appear in.
        Assert.Null(result!.Nav);
    }

    // ── v2: modules, no navigation ───────────────────────────────────────────────

    [Fact]
    public async Task A_v2_response_with_modules_but_no_nav_gets_one_synthesised_row_per_module()
    {
        var client = Responding("""
            { "modules": [
                { "key": "Lead", "displayName": "Leads",
                  "capabilities": [ { "key": "View", "displayName": "View" } ] },
                { "key": "AuditLog", "displayName": "Audit Logs",
                  "capabilities": [ { "key": "View", "displayName": "View" } ] } ] }
            """);

        var result = await client.FetchAsync("http://remote/permissions");

        Assert.NotNull(result!.Nav);
        Assert.Equal(2, result.Nav!.Count);

        // Synthesised rather than left empty: an un-upgraded remote keeps a working, correctly
        // permissioned sidebar. It falls back to the module key for the route and the display name
        // for the label, which is the best guess available without the remote saying more.
        var lead = result.Nav.Single(n => n.ModuleKey == "Lead");
        Assert.Equal("lead", lead.RouteSegment);
        Assert.Equal("Leads", lead.Label);
        Assert.Null(lead.RequiredCapability);
    }

    // ── v3/v4: declared navigation, descriptions and types ───────────────────────

    [Fact]
    public async Task A_v3_response_uses_the_rows_the_remote_declared()
    {
        var client = Responding("""
            { "modules": [
                { "key": "Lead", "displayName": "Leads",
                  "capabilities": [ { "key": "View", "displayName": "View" },
                                    { "key": "Create", "displayName": "Create" } ],
                  "nav": [ { "key": "view-lead", "label": "View Leads", "iconKey": "Users",
                             "routeSegment": "view-lead", "sortOrder": 10, "requiredCapability": "View" },
                           { "key": "create-lead", "label": "Create Lead", "iconKey": "UserPlus",
                             "routeSegment": "create-lead", "sortOrder": 20, "requiredCapability": "Create" } ] } ] }
            """);

        var result = await client.FetchAsync("http://remote/permissions");

        // Two rows over ONE module, differing only in the capability they require. A shape that
        // modelled navigation as a property of a module rather than a list would lose one of them.
        Assert.Equal(2, result!.Nav!.Count);
        Assert.Equal("View", result.Nav.Single(n => n.Key == "view-lead").RequiredCapability);
        Assert.Equal("Create", result.Nav.Single(n => n.Key == "create-lead").RequiredCapability);
    }

    [Fact]
    public async Task A_v4_capability_carries_its_description_and_type_through_unchanged()
    {
        var client = Responding("""
            { "modules": [
                { "key": "Dashboard", "displayName": "Dashboard",
                  "capabilities": [ { "key": "kpi.total-leads", "displayName": "Total Leads",
                                      "description": "The headline count", "type": "Widget" } ] } ] }
            """);

        var result = await client.FetchAsync("http://remote/permissions");

        var capability = Assert.Single(result!.Capabilities);
        Assert.Equal("The headline count", capability.Description);

        // The type decides DELIVERY: only "Api" capabilities are minted into the JWT. Losing it here
        // would put a dashboard widget into every token and grow it without bound.
        Assert.Equal("Widget", capability.Type);
    }

    [Fact]
    public async Task A_capability_with_no_type_is_treated_as_an_endpoint_guard()
    {
        var client = Responding("""
            { "modules": [ { "key": "Lead", "displayName": "Leads",
                             "capabilities": [ { "key": "View", "displayName": "View" } ] } ] }
            """);

        var result = await client.FetchAsync("http://remote/permissions");

        // Every remote predating the capability manifest declares only endpoint guards, and that is
        // exactly what "Api" means. Defaulting anywhere else would silently change how those
        // capabilities are delivered.
        Assert.Equal("Api", Assert.Single(result!.Capabilities).Type);
    }

    [Fact]
    public async Task A_capability_type_this_service_has_never_heard_of_is_relayed_verbatim()
    {
        var client = Responding("""
            { "modules": [ { "key": "Lead", "displayName": "Leads",
                             "capabilities": [ { "key": "x", "displayName": "X", "type": "SomethingNewer" } ] } ] }
            """);

        var result = await client.FetchAsync("http://remote/permissions");

        // Relayed, not parsed. Interpreting it here would make this a lossy hop for a payload a newer
        // remote deliberately made forward-compatible; the catalog is the one place that decides what
        // an unknown type means (it degrades to Api, which is the strict direction).
        Assert.Equal("SomethingNewer", Assert.Single(result!.Capabilities).Type);
    }

    // ── Failure paths: every one of them answers null ────────────────────────────

    [Fact]
    public async Task An_unreachable_source_answers_null_so_the_caller_can_tell_it_apart_from_declaring_nothing()
    {
        var client = Client(new ThrowingHandler());

        var result = await client.FetchAsync("http://remote/permissions");

        Assert.Null(result);
    }

    [Fact]
    public async Task A_non_success_status_answers_null()
    {
        var client = Responding("Service Unavailable", HttpStatusCode.ServiceUnavailable);

        Assert.Null(await client.FetchAsync("http://remote/permissions"));
    }

    [Fact]
    public async Task A_two_hundred_response_that_is_not_a_permissions_document_answers_null()
    {
        // A SPA index.html fallback or a proxy error page answers 200 with a body that parses as
        // neither shape. Reading that as "declares nothing" would deactivate every capability the app
        // has.
        var client = Responding("""{ "somethingElse": true }""");

        Assert.Null(await client.FetchAsync("http://remote/permissions"));
    }

    [Fact]
    public async Task Malformed_json_answers_null_rather_than_throwing()
    {
        var client = Responding("{ not json");

        Assert.Null(await client.FetchAsync("http://remote/permissions"));
    }

    [Fact]
    public async Task A_remote_that_genuinely_declares_an_empty_capability_list_is_not_confused_with_silence()
    {
        var client = Responding("""{ "capabilities": [] }""");

        var result = await client.FetchAsync("http://remote/permissions");

        // The distinction this whole class exists to protect: an empty list is a real answer and
        // comes back as an empty list, NOT as null. The catalog deactivates on this one and keeps the
        // stored set on a null.
        Assert.NotNull(result);
        Assert.Empty(result.Capabilities);
    }
}
