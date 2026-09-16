using AuthService.Infrastructure;
using AuthService.Infrastructure.Security;
using AuthService.Options;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using MsOptions = Microsoft.Extensions.Options.Options;

namespace AuthService.Tests;

/// <summary>
/// The service-to-service trust boundary: one key per service instead of one key for everyone.
/// </summary>
/// <remarks>
/// With a single shared key AuthService could not tell which service was calling, so any holder could
/// file approvals, write audit rows, or name a replay callback as any other service — and a leak in one
/// service was a leak in all of them. These tests pin that a key identifies exactly one service, that
/// the old shared key stops working once per-service keys exist, that a service can only point replays
/// at its own address, and that AuthService replays with the origin service's own key.
/// </remarks>
public class InternalServiceKeyTests
{
    private static InternalApiOptions PerService() => new()
    {
        ApiKey = "legacy-shared-key",
        Services =
        {
            ["LeadService"] = new InternalServiceCredential { ApiKey = "lead-key", CallbackBaseUrl = "http://localhost:5046/api/lead-service" },
            ["ProductsService"] = new InternalServiceCredential { ApiKey = "products-key" },
        },
    };

    private static AuthorizationFilterContext ContextWithKey(string? key)
    {
        var http = new DefaultHttpContext();
        if (key is not null) http.Request.Headers["X-Internal-Api-Key"] = key;
        return new AuthorizationFilterContext(new ActionContext(http, new RouteData(), new ActionDescriptor()), []);
    }

    private static Task RunAsync(InternalApiOptions options, AuthorizationFilterContext context) =>
        new InternalApiKeyFilter(MsOptions.Create(options), NullLogger<InternalApiKeyFilter>.Instance).OnAuthorizationAsync(context);

    [Fact]
    public async Task A_service_key_is_accepted_and_identifies_that_service()
    {
        var context = ContextWithKey("products-key");

        await RunAsync(PerService(), context);

        Assert.Null(context.Result);
        Assert.Equal("ProductsService", InternalCaller.Get(context.HttpContext));
    }

    [Fact]
    public async Task Surrounding_whitespace_in_the_header_does_not_break_a_valid_key()
    {
        var context = ContextWithKey("  lead-key \n");

        await RunAsync(PerService(), context);

        Assert.Null(context.Result);
        Assert.Equal("LeadService", InternalCaller.Get(context.HttpContext));
    }

    /// <summary>The whole point of migrating: the old key must not keep working alongside the new ones.</summary>
    [Fact]
    public async Task The_legacy_shared_key_is_refused_once_per_service_keys_exist()
    {
        var context = ContextWithKey("legacy-shared-key");

        await RunAsync(PerService(), context);

        Assert.IsType<UnauthorizedObjectResult>(context.Result);
    }

    [Fact]
    public async Task The_legacy_shared_key_still_works_before_migration_but_identifies_nobody()
    {
        var context = ContextWithKey("legacy-shared-key");

        await RunAsync(new InternalApiOptions { ApiKey = "legacy-shared-key" }, context);

        Assert.Null(context.Result);
        Assert.Null(InternalCaller.Get(context.HttpContext));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-a-key")]
    public async Task A_missing_or_wrong_key_is_refused(string? key)
    {
        var context = ContextWithKey(key);

        await RunAsync(PerService(), context);

        Assert.IsType<UnauthorizedObjectResult>(context.Result);
    }

    [Fact]
    public async Task With_nothing_configured_the_internal_surface_fails_closed()
    {
        var context = ContextWithKey("anything");

        await RunAsync(new InternalApiOptions(), context);

        var result = Assert.IsType<ObjectResult>(context.Result);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, result.StatusCode);
    }

    [Fact]
    public void A_service_may_name_a_callback_under_its_registered_address()
    {
        Assert.Null(InternalCallbackPolicy.Check(PerService(), "LeadService", "http://localhost:5046/api/lead-service/internal/approvals/apply"));
    }

    [Theory]
    [InlineData("http://evil.example/api/lead-service/internal/approvals/apply")]
    [InlineData("http://localhost:9999/api/lead-service/internal/approvals/apply")]
    [InlineData("http://localhost:5046/api/lead-service-evil/internal/approvals/apply")]
    [InlineData("http://localhost:5046/other/internal/approvals/apply")]
    public void A_service_may_not_point_its_replay_anywhere_else(string callbackUrl)
    {
        Assert.NotNull(InternalCallbackPolicy.Check(PerService(), "LeadService", callbackUrl));
    }

    [Theory]
    [InlineData("not a url")]
    [InlineData("file:///etc/passwd")]
    [InlineData("")]
    public void A_callback_must_be_an_absolute_http_address_for_everyone(string callbackUrl)
    {
        Assert.NotNull(InternalCallbackPolicy.Check(PerService(), "ProductsService", callbackUrl));
        Assert.NotNull(InternalCallbackPolicy.Check(PerService(), null, callbackUrl));
    }

    [Fact]
    public void A_service_without_a_registered_address_may_use_any_http_callback()
    {
        Assert.Null(InternalCallbackPolicy.Check(PerService(), "ProductsService", "http://localhost:5266/internal/approvals/apply"));
    }

    /// <summary>Each remote only ever sees its own key — never another service's.</summary>
    [Fact]
    public void A_replay_is_sent_with_the_origin_services_own_key()
    {
        Assert.Equal("lead-key", RemoteApprovalCallbackClient.ResolveKey(PerService(), "LeadService"));
        Assert.Equal("products-key", RemoteApprovalCallbackClient.ResolveKey(PerService(), "productsservice"));
    }

    [Fact]
    public void A_replay_to_a_service_with_no_key_is_refused_rather_than_sent_with_another_key()
    {
        var error = Assert.Throws<InvalidOperationException>(() => RemoteApprovalCallbackClient.ResolveKey(PerService(), "Customer360Service"));

        Assert.Contains("Internal__Services__Customer360Service__ApiKey", error.Message);
    }

    [Fact]
    public void Before_migration_a_replay_uses_the_legacy_shared_key()
    {
        Assert.Equal("legacy-shared-key", RemoteApprovalCallbackClient.ResolveKey(new InternalApiOptions { ApiKey = "legacy-shared-key" }, "LeadService"));
    }
}
