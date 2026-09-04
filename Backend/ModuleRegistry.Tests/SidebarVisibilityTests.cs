using System.Security.Claims;
using System.Text.Json;
using ModuleRegistry.Application.Services;
using ModuleRegistry.Domain.Entities;
using ModuleRegistry.Domain.Enums;
using ModuleRegistry.Infrastructure;
using ModuleRegistry.Infrastructure.Security;
using ModuleRegistry.Options;
using MsOptions = Microsoft.Extensions.Options.Options;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace ModuleRegistry.Tests;

/// <summary>
/// Which registered apps a caller is told about, and this service's own authorization filter.
/// </summary>
/// <remarks>
/// The sidebar list is a permission-filtered read: an app the caller holds nothing on must not appear,
/// because appearing is itself information — it tells them the app exists and is installed. The filter
/// tested at the bottom guards this service's own admin surface.
/// </remarks>
public class SidebarVisibilityTests : IDisposable
{
    private readonly ModuleRegistryDbContext db;
    private readonly RemoteAppAppService service;

    public SidebarVisibilityTests()
    {
        var options = new DbContextOptionsBuilder<ModuleRegistryDbContext>()
            .UseInMemoryDatabase($"sidebar-{Guid.NewGuid()}")
            .Options;

        db = new ModuleRegistryDbContext(options);

        service = new RemoteAppAppService(
            db,
            new AuthServiceClient(
                new HttpClient(new NoopHandler()),
                MsOptions.Create(new AuthIntegrationOptions { BaseUrl = "http://auth.test", InternalApiKey = "k" }),
                NullLogger<AuthServiceClient>.Instance,
                new HttpContextAccessor()),
            new RemoteManifestClient(new HttpClient(new NoopHandler()), NullLogger<RemoteManifestClient>.Instance),
            NullLogger<RemoteAppAppService>.Instance,
            MsOptions.Create(new SelfOptions()));
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    // ---------------------------------------------------------------- what the sidebar shows

    [Fact]
    public async Task An_app_the_caller_holds_nothing_on_is_not_listed()
    {
        await SeedAsync("lead");
        await SeedAsync("customer360");

        var visible = await service.GetForSidebarAsync(false, Permissions("remote.lead.lead:View"));

        Assert.Equal(["lead"], visible.Select(a => a.Key));
    }

    [Fact]
    public async Task A_capability_on_a_sub_module_is_enough_to_see_the_app()
    {
        // Apps declare their capabilities on sub-modules, so requiring one on the parent key would
        // hide every app from everyone who is not an administrator.
        await SeedAsync("lead");

        var visible = await service.GetForSidebarAsync(false, Permissions("remote.lead.dashboard:View"));

        Assert.Single(visible);
    }

    [Fact]
    public async Task An_administrator_sees_every_app_without_holding_anything()
    {
        await SeedAsync("lead");
        await SeedAsync("customer360");

        var visible = await service.GetForSidebarAsync(true, Permissions());

        Assert.Equal(2, visible.Count);
    }

    [Fact]
    public async Task A_disabled_app_is_hidden_even_from_an_administrator()
    {
        // Disabled means withdrawn from the platform, not merely unauthorised — so it is not an
        // administrator's to see either, and listing it would invite clicking into a dead remote.
        await SeedAsync("lead", status: RemoteAppStatus.Disabled);

        Assert.Empty(await service.GetForSidebarAsync(true, Permissions()));
    }

    [Fact]
    public async Task Apps_come_back_in_the_configured_order()
    {
        await SeedAsync("zulu", order: 1);
        await SeedAsync("alpha", order: 2);

        var visible = await service.GetForSidebarAsync(true, Permissions());

        // By configured position, not alphabetically — the order an operator set is the answer.
        Assert.Equal(["zulu", "alpha"], visible.Select(a => a.Key));
    }

    [Fact]
    public async Task A_permission_for_a_different_app_does_not_reveal_this_one()
    {
        /*
         * Prefix matching is the trap here. `remote.lead` is a prefix of nothing else today, but an app
         * keyed `lead-archive` would make `remote.lead` a prefix of `remote.lead-archive` — and a naive
         * StartsWith would leak the second to anyone holding the first.
         */
        await SeedAsync("lead-archive");

        var visible = await service.GetForSidebarAsync(false, Permissions("remote.lead.lead:View"));

        Assert.Empty(visible);
    }

    [Fact]
    public async Task Health_is_filtered_by_the_same_rule_as_the_sidebar()
    {
        // The health panel would otherwise be a way to enumerate apps the caller cannot see listed.
        await SeedAsync("lead");
        await SeedAsync("customer360");

        var health = await service.GetHealthAsync(false, Permissions("remote.lead.lead:View"));

        Assert.Equal(["lead"], health.Select(h => h.Key));
    }

    // ---------------------------------------------------------------- this service's own filter

    [Fact]
    public async Task The_permission_filter_authorises_an_exact_match()
    {
        var context = ContextFor(User(permissions: ["host.settings.applications:View"]));

        await new RequirePermissionAttribute("host.settings.applications", "View").OnAuthorizationAsync(context);

        Assert.Null(context.Result);
    }

    [Fact]
    public async Task The_permission_filter_refuses_what_was_not_granted()
    {
        var context = ContextFor(User(permissions: ["host.settings.applications:View"]));

        await new RequirePermissionAttribute("host.settings.applications", "Register").OnAuthorizationAsync(context);

        Assert.Equal(StatusCodes.Status403Forbidden, ((ObjectResult)context.Result!).StatusCode);
    }

    [Fact]
    public async Task The_permission_filter_matches_case_insensitively_like_the_remotes_do()
    {
        // This filter compared ordinally while the two remote services did not, so the same grant
        // could authorise in one service and be refused in another.
        var context = ContextFor(User(permissions: ["host.settings.applications:view"]));

        await new RequirePermissionAttribute("host.settings.applications", "View").OnAuthorizationAsync(context);

        Assert.Null(context.Result);
    }

    [Fact]
    public async Task The_permission_filter_lets_an_administrator_through()
    {
        var context = ContextFor(User(administrator: true));

        await new RequirePermissionAttribute("host.settings.applications", "Register").OnAuthorizationAsync(context);

        Assert.Null(context.Result);
    }

    [Fact]
    public async Task The_permission_filter_denies_on_an_unparseable_claim_rather_than_throwing()
    {
        var identity = new ClaimsIdentity(
            [
                new Claim("administrator", "false"),
                new Claim("perms", "{not json"),
            ],
            "Test");

        var context = ContextFor(new ClaimsPrincipal(identity));

        await new RequirePermissionAttribute("host.settings.applications", "View").OnAuthorizationAsync(context);

        Assert.Equal(StatusCodes.Status403Forbidden, ((ObjectResult)context.Result!).StatusCode);
    }

    [Fact]
    public async Task The_permission_filter_answers_401_for_an_anonymous_caller()
    {
        var context = ContextFor(new ClaimsPrincipal(new ClaimsIdentity()));

        await new RequirePermissionAttribute("host.settings.applications", "View").OnAuthorizationAsync(context);

        Assert.IsType<UnauthorizedResult>(context.Result);
    }

    // ---------------------------------------------------------------- fixture

    private static IReadOnlySet<string> Permissions(params string[] permissions) =>
        permissions.ToHashSet(StringComparer.OrdinalIgnoreCase);

    private static ClaimsPrincipal User(bool administrator = false, string[]? permissions = null)
    {
        var identity = new ClaimsIdentity(
            [
                new Claim("administrator", administrator ? "true" : "false"),
                new Claim("perms", JsonSerializer.Serialize(permissions ?? [])),
            ],
            "Test");

        return new ClaimsPrincipal(identity);
    }

    private static AuthorizationFilterContext ContextFor(ClaimsPrincipal user) =>
        new(new ActionContext(new DefaultHttpContext { User = user }, new RouteData(), new ActionDescriptor()), []);

    private async Task SeedAsync(string key, int order = 1, RemoteAppStatus status = RemoteAppStatus.Active)
    {
        db.RemoteApps.Add(new RemoteApp
        {
            Id = Guid.NewGuid(),
            Key = key,
            DisplayName = key,
            ManifestUrl = $"http://{key}.test/mf-manifest.json",
            ContainerName = $"{key}_mf",
            PermissionFeatureKey = $"remote.{key}",
            SidebarOrder = order,
            Status = status,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });

        await db.SaveChangesAsync();
    }

    private sealed class NoopHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            => Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.NoContent));
    }
}
