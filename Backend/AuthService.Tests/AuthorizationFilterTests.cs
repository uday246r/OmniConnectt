using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.Json;
using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Domain.Entities;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Security;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// The two authorization filters, exercised directly.
/// </summary>
/// <remarks>
/// They answer the same question from two different sources — the JWT claim for API capabilities, the
/// resolved set for everything else — and they have to agree on everything except where they read
/// from. A discrepancy between them is not a cosmetic inconsistency; it is a permission that holds in
/// one place and not another.
/// </remarks>
public class AuthorizationFilterTests : IDisposable
{
    private readonly AuthDbContext db;
    private readonly PermissionCatalogAppService catalog;
    private readonly FineCapabilityService fine;
    private readonly ServiceProvider services;

    public AuthorizationFilterTests()
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"filters-{Guid.NewGuid()}")
            .Options;

        db = new AuthDbContext(options);

        var memory = new MemoryCache(new MemoryCacheOptions());
        fine = new FineCapabilityService(db, memory);
        catalog = new PermissionCatalogAppService(db, memory, fine);

        var collection = new ServiceCollection();
        collection.AddSingleton(fine);
        services = collection.BuildServiceProvider();
    }

    public void Dispose()
    {
        services.Dispose();
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    // ---------------------------------------------------------------- the claim-reading filter

    [Fact]
    public async Task An_api_capability_in_the_claim_authorises()
    {
        var context = ContextFor(Authenticated(permissions: ["remote.lead.lead:View"]));

        await new RequirePermissionAttribute("remote.lead.lead", "View").OnAuthorizationAsync(context);

        Assert.Null(context.Result);
    }

    [Fact]
    public async Task An_api_capability_absent_from_the_claim_is_refused_with_403()
    {
        var context = ContextFor(Authenticated(permissions: ["remote.lead.lead:View"]));

        await new RequirePermissionAttribute("remote.lead.lead", "Delete").OnAuthorizationAsync(context);

        Assert.Equal(StatusCodes.Status403Forbidden, ((ObjectResult)context.Result!).StatusCode);
    }

    [Fact]
    public async Task Casing_no_longer_decides_the_answer()
    {
        // This filter compared ordinally while LeadService and Customer360Service did not, so the
        // same grant could authorise in one service and be refused in another.
        var context = ContextFor(Authenticated(permissions: ["remote.lead.lead:view"]));

        await new RequirePermissionAttribute("remote.lead.lead", "View").OnAuthorizationAsync(context);

        Assert.Null(context.Result);
    }

    [Fact]
    public async Task A_capability_of_one_feature_does_not_authorise_another()
    {
        // A prefix comparison once collapsed every module of an app into one, so a read-only viewer
        // passed a delete check. It is a full-string match and has to stay one.
        var context = ContextFor(Authenticated(permissions: ["remote.lead.lead:View"]));

        await new RequirePermissionAttribute("remote.lead", "View").OnAuthorizationAsync(context);

        Assert.NotNull(context.Result);
    }

    [Fact]
    public async Task An_unparseable_claim_denies_rather_than_throwing()
    {
        var identity = new ClaimsIdentity(
            [
                new Claim(JwtRegisteredClaimNames.Sub, Guid.NewGuid().ToString()),
                new Claim(JwtTokenService.AdministratorClaimType, "false"),
                new Claim(JwtTokenService.PermissionsClaimType, "{not json"),
            ],
            "Test");
        var context = ContextFor(new ClaimsPrincipal(identity));

        await new RequirePermissionAttribute("remote.lead.lead", "View").OnAuthorizationAsync(context);

        // Fails closed, and as a refusal rather than a 500 — a 500 reads as a server fault and
        // invites a retry loop over what is actually a settled "no".
        Assert.Equal(StatusCodes.Status403Forbidden, ((ObjectResult)context.Result!).StatusCode);
    }

    [Fact]
    public async Task An_anonymous_caller_is_401_not_403()
    {
        var context = ContextFor(new ClaimsPrincipal(new ClaimsIdentity()));

        await new RequirePermissionAttribute("remote.lead.lead", "View").OnAuthorizationAsync(context);

        Assert.IsType<UnauthorizedResult>(context.Result);
    }

    // ---------------------------------------------------------------- the fine-grained filter

    [Fact]
    public async Task A_granted_business_capability_authorises_even_though_it_is_not_in_the_token()
    {
        var user = await GrantAsync("kpi.total-leads");
        var context = ContextFor(Authenticated(user.Id, permissions: []));

        await RunFineAsync(context, "remote.lead.dashboard", "kpi.total-leads");

        Assert.Null(context.Result);
    }

    [Fact]
    public async Task An_ungranted_business_capability_is_refused_with_403()
    {
        var user = await GrantAsync("kpi.total-leads");
        var context = ContextFor(Authenticated(user.Id, permissions: []));

        await RunFineAsync(context, "remote.lead.dashboard", "kpi.converted");

        Assert.Equal(StatusCodes.Status403Forbidden, ((ObjectResult)context.Result!).StatusCode);
    }

    [Fact]
    public async Task An_administrator_passes_the_fine_grained_filter_on_the_claim_alone()
    {
        // No database read at all: the administrator claim short-circuits, which also means an
        // administrator is unaffected if the resolver is momentarily unavailable.
        var context = ContextFor(Authenticated(Guid.NewGuid(), permissions: [], administrator: true));

        await RunFineAsync(context, "remote.lead.dashboard", "kpi.total-leads");

        Assert.Null(context.Result);
    }

    [Fact]
    public async Task A_token_with_no_usable_subject_is_refused_rather_than_treated_as_holding_nothing()
    {
        // "No subject" cannot be resolved, and the two safe answers differ: 401 says the credential
        // is unusable, 403 would claim the permission was checked and denied.
        var identity = new ClaimsIdentity(
            [new Claim(JwtTokenService.AdministratorClaimType, "false")], "Test");
        var context = ContextFor(new ClaimsPrincipal(identity));

        await RunFineAsync(context, "remote.lead.dashboard", "kpi.total-leads");

        Assert.IsType<UnauthorizedResult>(context.Result);
    }

    [Fact]
    public async Task A_business_capability_a_user_holds_is_never_reachable_through_the_claim_filter()
    {
        /*
         * The two halves must not overlap.
         *
         * A business capability is not in the token, so the claim-reading filter cannot see it — and
         * if someone ever guards an endpoint with the wrong attribute, this is what makes that a
         * refusal rather than a silent grant to everybody. Checked as a pair with the test above,
         * which proves the correct filter does allow it.
         */
        var user = await GrantAsync("kpi.total-leads");
        var context = ContextFor(Authenticated(user.Id, permissions: []));

        await new RequirePermissionAttribute("remote.lead.dashboard", "kpi.total-leads")
            .OnAuthorizationAsync(context);

        Assert.Equal(StatusCodes.Status403Forbidden, ((ObjectResult)context.Result!).StatusCode);
    }

    // ---------------------------------------------------------------- helpers

    private async Task RunFineAsync(AuthorizationFilterContext context, string featureKey, string capability)
    {
        var filter = (IAsyncAuthorizationFilter)new RequiresFineCapabilityAttribute(featureKey, capability)
            .CreateInstance(services);
        await filter.OnAuthorizationAsync(context);
    }

    private async Task<User> GrantAsync(params string[] capabilities)
    {
        await catalog.UpsertRemoteAppFeatureAsync(
            "remote.lead", "Lead Management", 10, [],
            [
                new UpsertModuleRequest("dashboard", "Dashboard", 10,
                [
                    new UpsertCapabilityRequest("View", "View"),
                    new UpsertCapabilityRequest("kpi.total-leads", "Total Leads", 100, Type: "Widget"),
                    new UpsertCapabilityRequest("kpi.converted", "Converted", 110, Type: "Widget"),
                ]),
            ]);

        var feature = await db.PermissionFeatures.FirstAsync(f => f.Key == "remote.lead.dashboard");

        var role = new Role { Id = Guid.NewGuid(), Name = "Tester" };
        db.Roles.Add(role);
        foreach (var capability in capabilities)
        {
            db.RolePermissions.Add(new RolePermission
            {
                Id = Guid.NewGuid(),
                RoleId = role.Id,
                FeatureId = feature.Id,
                Capability = capability,
            });
        }

        var user = new User
        {
            Id = Guid.NewGuid(),
            Name = "Tester",
            Email = "tester@example.com",
            RoleId = role.Id,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        return user;
    }

    private static ClaimsPrincipal Authenticated(
        Guid? userId = null, string[]? permissions = null, bool administrator = false)
    {
        var identity = new ClaimsIdentity(
            [
                new Claim(JwtRegisteredClaimNames.Sub, (userId ?? Guid.NewGuid()).ToString()),
                new Claim(JwtTokenService.AdministratorClaimType, administrator ? "true" : "false"),
                new Claim(JwtTokenService.PermissionsClaimType, JsonSerializer.Serialize(permissions ?? [])),
            ],
            // A non-empty authentication type is what makes IsAuthenticated true.
            "Test");

        return new ClaimsPrincipal(identity);
    }

    private static AuthorizationFilterContext ContextFor(ClaimsPrincipal user) =>
        new(
            new ActionContext(
                new DefaultHttpContext { User = user },
                new RouteData(),
                new ActionDescriptor()),
            []);
}
