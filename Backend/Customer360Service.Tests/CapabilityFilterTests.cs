using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using backend.Infrastructure.Security;
using backend.Options;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace Customer360Service.Tests;

/// <summary>
/// The two authorization filters this service enforces its own capabilities with.
/// </summary>
/// <remarks>
/// They answer the same question from two sources — the JWT claim for API capabilities, a resolved
/// set for the fine-grained ones — and must agree on everything except where they read from. Both are
/// authorization-stage filters deliberately, so a refusal precedes model binding and cannot be
/// pre-empted by a 400 from an invalid body.
/// </remarks>
public class CapabilityFilterTests : IDisposable
{
    private readonly ServiceProvider services;

    public CapabilityFilterTests()
    {
        var collection = new ServiceCollection();
        collection.AddSingleton(_ => Client("remote.customer360.profile:panel.contacts"));
        services = collection.BuildServiceProvider();
    }

    public void Dispose()
    {
        services.Dispose();
        GC.SuppressFinalize(this);
    }

    // ---------------------------------------------------------------- the claim-reading filter

    [Fact]
    public async Task A_capability_in_the_claim_authorises()
    {
        var context = ContextFor(Authenticated(permissions: ["remote.customer360.contact:View"]));

        await new RequiresCapabilityAttribute("contact", "View").OnAuthorizationAsync(context);

        Assert.Null(context.Result);
    }

    [Fact]
    public async Task A_capability_absent_from_the_claim_is_refused_with_403()
    {
        var context = ContextFor(Authenticated(permissions: ["remote.customer360.contact:View"]));

        await new RequiresCapabilityAttribute("contact", "Delete").OnAuthorizationAsync(context);

        Assert.Equal(StatusCodes.Status403Forbidden, ((ObjectResult)context.Result!).StatusCode);
    }

    [Fact]
    public async Task One_module_does_not_authorise_another()
    {
        /*
         * The regression this locks down permanently.
         *
         * The check once ended with `p.StartsWith("remote.customer360.")`, and since every permission this
         * service can grant begins that way, the whole check collapsed into "does the caller hold ANY
         * permission in this app?". A read-only viewer passed a Delete check and could rewrite the
         * field configuration.
         */
        var context = ContextFor(Authenticated(permissions: ["remote.customer360.contact:View"]));

        await new RequiresCapabilityAttribute("fieldsettings", "Manage").OnAuthorizationAsync(context);

        Assert.NotNull(context.Result);
    }

    [Fact]
    public async Task The_parent_feature_key_alone_authorises_nothing()
    {
        var context = ContextFor(Authenticated(permissions: ["remote.customer360:View"]));

        await new RequiresCapabilityAttribute("contact", "View").OnAuthorizationAsync(context);

        Assert.NotNull(context.Result);
    }

    [Fact]
    public async Task An_administrator_passes_without_holding_the_capability()
    {
        var context = ContextFor(Authenticated(administrator: true));

        await new RequiresCapabilityAttribute("contact", "Delete").OnAuthorizationAsync(context);

        Assert.Null(context.Result);
    }

    [Fact]
    public async Task Only_the_administrator_claim_the_platform_issues_is_honoured()
    {
        /*
         * This filter once also accepted `user.IsInRole("Admin")`. IsInRole matches any claim of the
         * token's role-claim type, so anyone who could get a role-shaped claim named "Admin" into a
         * token received a full authorization bypass here — while the services that check only the
         * `administrator` claim correctly refused the same token.
         */
        var identity = new ClaimsIdentity(
            [
                new Claim(JwtClaimTypes.Subject, Guid.NewGuid().ToString()),
                new Claim(ClaimTypes.Role, "Admin"),
                new Claim(JwtClaimTypes.Permissions, "[]"),
            ],
            "Test", ClaimTypes.Name, ClaimTypes.Role);

        var context = ContextFor(new ClaimsPrincipal(identity));

        await new RequiresCapabilityAttribute("contact", "Delete").OnAuthorizationAsync(context);

        Assert.NotNull(context.Result);
    }

    [Fact]
    public async Task Matching_is_case_insensitive_because_the_keys_are_hand_authored()
    {
        var context = ContextFor(Authenticated(permissions: ["remote.customer360.contact:view"]));

        await new RequiresCapabilityAttribute("contact", "View").OnAuthorizationAsync(context);

        Assert.Null(context.Result);
    }

    [Fact]
    public async Task An_unparseable_claim_denies_rather_than_throwing()
    {
        // Fails closed, and as a refusal rather than a 500 — a 500 reads as a server fault and invites
        // a retry over what is actually a settled "no".
        var identity = new ClaimsIdentity(
            [
                new Claim(JwtClaimTypes.Subject, Guid.NewGuid().ToString()),
                new Claim(JwtClaimTypes.Administrator, "false"),
                new Claim(JwtClaimTypes.Permissions, "{not json"),
            ],
            "Test");

        var context = ContextFor(new ClaimsPrincipal(identity));

        await new RequiresCapabilityAttribute("contact", "View").OnAuthorizationAsync(context);

        Assert.Equal(StatusCodes.Status403Forbidden, ((ObjectResult)context.Result!).StatusCode);
    }

    [Fact]
    public async Task An_anonymous_caller_is_401_not_403()
    {
        var context = ContextFor(new ClaimsPrincipal(new ClaimsIdentity()));

        await new RequiresCapabilityAttribute("contact", "View").OnAuthorizationAsync(context);

        Assert.IsType<UnauthorizedResult>(context.Result);
    }

    // ---------------------------------------------------------------- the fine-grained filter

    [Fact]
    public async Task A_granted_business_capability_authorises_although_it_is_not_in_the_token()
    {
        var context = ContextFor(Authenticated(permissions: []));

        await RunFineAsync(context, "profile", "panel.contacts");

        Assert.Null(context.Result);
    }

    [Fact]
    public async Task An_ungranted_business_capability_is_refused_with_403()
    {
        var context = ContextFor(Authenticated(permissions: []));

        await RunFineAsync(context, "profile", "panel.products");

        Assert.Equal(StatusCodes.Status403Forbidden, ((ObjectResult)context.Result!).StatusCode);
    }

    [Fact]
    public async Task A_business_capability_the_user_holds_is_still_refused_by_the_claim_filter()
    {
        /*
         * The two halves must not overlap. A business capability is never in the token, so if someone
         * guards an endpoint with the wrong attribute this is a refusal rather than a silent grant to
         * everybody — which is the failure that would be hardest to notice.
         */
        var context = ContextFor(Authenticated(permissions: []));

        await new RequiresCapabilityAttribute("profile", "panel.contacts").OnAuthorizationAsync(context);

        Assert.Equal(StatusCodes.Status403Forbidden, ((ObjectResult)context.Result!).StatusCode);
    }

    [Fact]
    public async Task An_administrator_passes_the_fine_grained_filter_on_the_claim_alone()
    {
        var context = ContextFor(Authenticated(administrator: true));

        await RunFineAsync(context, "profile", "panel.products");

        Assert.Null(context.Result);
    }

    [Fact]
    public async Task A_token_with_no_usable_subject_is_401_rather_than_403()
    {
        // The two say different things: 401 means the credential is unusable, 403 would claim the
        // permission was checked and denied.
        var identity = new ClaimsIdentity([new Claim(JwtClaimTypes.Administrator, "false")], "Test");
        var context = ContextFor(new ClaimsPrincipal(identity));

        await RunFineAsync(context, "profile", "panel.contacts");

        Assert.IsType<UnauthorizedResult>(context.Result);
    }

    // ---------------------------------------------------------------- fixture

    private async Task RunFineAsync(AuthorizationFilterContext context, string module, string capability)
    {
        var filter = (IAsyncAuthorizationFilter)new RequiresFineCapabilityAttribute(module, capability)
            .CreateInstance(services);
        await filter.OnAuthorizationAsync(context);
    }

    private static FineCapabilityClient Client(params string[] capabilities)
    {
        var body = JsonSerializer.Serialize(new { capabilities });
        var handler = new StubHandler(() => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        });

        return new FineCapabilityClient(
            new HttpClient(handler),
            Options.Create(new AuthIntegrationOptions { BaseUrl = "http://auth.test", InternalApiKey = "k" }),
            new MemoryCache(new MemoryCacheOptions()),
            NullLogger<FineCapabilityClient>.Instance);
    }

    private static ClaimsPrincipal Authenticated(bool administrator = false, string[]? permissions = null)
    {
        var identity = new ClaimsIdentity(
            [
                new Claim(JwtClaimTypes.Subject, Guid.NewGuid().ToString()),
                new Claim(JwtClaimTypes.Administrator, administrator ? "true" : "false"),
                new Claim(JwtClaimTypes.Permissions, JsonSerializer.Serialize(permissions ?? [])),
            ],
            "Test");

        return new ClaimsPrincipal(identity);
    }

    private static AuthorizationFilterContext ContextFor(ClaimsPrincipal user) =>
        new(new ActionContext(new DefaultHttpContext { User = user }, new RouteData(), new ActionDescriptor()), []);

    private sealed class StubHandler(Func<HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            => Task.FromResult(respond());
    }
}
