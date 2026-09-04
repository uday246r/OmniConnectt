using System.Net;
using System.Text;
using LeadManagement.Api.Infrastructure.Security;
using LeadManagement.Api.Options;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace LeadService.Tests;

/// <summary>
/// How this service answers "does that user hold this capability" when the answer lives in another
/// service — and, more importantly, what it answers when it cannot find out.
/// </summary>
/// <remarks>
/// API capabilities ride in the JWT and cost nothing to check. Fine-grained ones deliberately do not,
/// which buys a bounded token and costs a network call. That trade is only safe because of the
/// behaviour asserted here: an unanswerable question about a permission is answered "no". Get that
/// backwards and every AuthService outage becomes an authorization bypass across every remote.
/// </remarks>
public class FineCapabilityClientTests
{
    private static readonly Guid UserId = Guid.NewGuid();
    private const string Granted = "remote.lead.dashboard:kpi.total-leads";

    // ---------------------------------------------------------------- the happy path

    [Fact]
    public async Task It_returns_what_AuthService_says_the_user_holds()
    {
        var client = Build(Responds(HttpStatusCode.OK, $$"""{"capabilities":["{{Granted}}"]}"""));

        Assert.Equal([Granted], await client.GetForUserAsync(UserId));
    }

    [Fact]
    public async Task An_empty_set_is_a_real_answer_not_an_error()
    {
        var client = Build(Responds(HttpStatusCode.OK, """{"capabilities":[]}"""));

        Assert.Empty(await client.GetForUserAsync(UserId));
    }

    // ---------------------------------------------------------------- failing closed

    [Fact]
    public async Task An_unreachable_AuthService_grants_nothing()
    {
        // The assertion the whole design rests on. Assuming the capability while AuthService is down
        // would turn an outage into an open door on exports and bulk operations.
        var client = Build(Throws(new HttpRequestException("connection refused")));

        Assert.Empty(await client.GetForUserAsync(UserId));
    }

    [Fact]
    public async Task A_non_success_response_grants_nothing()
    {
        var client = Build(Responds(HttpStatusCode.InternalServerError, "boom"));

        Assert.Empty(await client.GetForUserAsync(UserId));
    }

    [Fact]
    public async Task An_unconfigured_base_url_grants_nothing_and_makes_no_request()
    {
        // A misconfigured deployment must refuse rather than silently allow, and must not sit there
        // issuing requests to an empty host.
        var handler = Responds(HttpStatusCode.OK, $$"""{"capabilities":["{{Granted}}"]}""");
        var client = Build(handler, baseUrl: "");

        Assert.Empty(await client.GetForUserAsync(UserId));
        Assert.Equal(0, handler.Calls);
    }

    // ---------------------------------------------------------------- caching

    [Fact]
    public async Task A_successful_answer_is_cached_rather_than_re_fetched_per_check()
    {
        // A dashboard gating a dozen widgets must not make a dozen round trips.
        var handler = Responds(HttpStatusCode.OK, $$"""{"capabilities":["{{Granted}}"]}""");
        var client = Build(handler);

        await client.GetForUserAsync(UserId);
        await client.GetForUserAsync(UserId);
        await client.GetForUserAsync(UserId);

        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public async Task A_failure_is_not_cached_so_one_blip_does_not_deny_for_the_whole_window()
    {
        /*
         * Caching a refusal would stretch a momentary failure into thirty seconds of denial for that
         * user. The retry is one cheap request; the alternative is a user staring at a page missing
         * half its content long after the cause has cleared.
         */
        var handler = new SequenceHandler(
            _ => throw new HttpRequestException("connection refused"),
            _ => Json(HttpStatusCode.OK, $$"""{"capabilities":["{{Granted}}"]}"""));

        var client = Build(handler);

        Assert.Empty(await client.GetForUserAsync(UserId));
        Assert.Equal([Granted], await client.GetForUserAsync(UserId));
    }

    [Fact]
    public async Task Each_user_is_cached_separately()
    {
        var other = Guid.NewGuid();
        var handler = new SequenceHandler(
            _ => Json(HttpStatusCode.OK, $$"""{"capabilities":["{{Granted}}"]}"""),
            _ => Json(HttpStatusCode.OK, """{"capabilities":[]}"""));

        var client = Build(handler);

        Assert.Equal([Granted], await client.GetForUserAsync(UserId));
        Assert.Empty(await client.GetForUserAsync(other));
    }

    // ---------------------------------------------------------------- the request itself

    [Fact]
    public async Task It_asks_for_the_right_user_and_presents_the_internal_key()
    {
        var handler = Responds(HttpStatusCode.OK, """{"capabilities":[]}""");
        var client = Build(handler, internalApiKey: "the-key");

        await client.GetForUserAsync(UserId);

        Assert.Contains($"/internal/capabilities/{UserId}", handler.LastUri);
        Assert.Equal("the-key", handler.LastApiKey);
    }

    // ---------------------------------------------------------------- fixture

    private static FineCapabilityClient Build(
        HttpMessageHandler handler,
        string baseUrl = "http://auth.test",
        string internalApiKey = "test-key")
    {
        var options = Options.Create(new AuthIntegrationOptions
        {
            BaseUrl = baseUrl,
            InternalApiKey = internalApiKey,
        });

        return new FineCapabilityClient(
            new HttpClient(handler),
            options,
            new MemoryCache(new MemoryCacheOptions()),
            NullLogger<FineCapabilityClient>.Instance);
    }

    private static HttpResponseMessage Json(HttpStatusCode status, string body) =>
        new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private static CountingHandler Responds(HttpStatusCode status, string body) => new(status, body);

    private static SequenceHandler Throws(Exception ex) => new(_ => throw ex);

    /// <summary>Answers every request the same way, and counts how many there were.</summary>
    private sealed class CountingHandler(HttpStatusCode status, string body) : HttpMessageHandler
    {
        public int Calls { get; private set; }
        public string LastUri { get; private set; } = string.Empty;
        public string? LastApiKey { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Calls++;
            LastUri = request.RequestUri?.ToString() ?? string.Empty;
            LastApiKey = request.Headers.TryGetValues("X-Internal-Api-Key", out var v) ? v.FirstOrDefault() : null;

            return Task.FromResult(Json(status, body));
        }
    }

    /// <summary>Answers each successive request from a list, so a retry can be given a different outcome.</summary>
    private sealed class SequenceHandler(params Func<HttpRequestMessage, HttpResponseMessage>[] steps) : HttpMessageHandler
    {
        private int index;

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var step = steps[Math.Min(index++, steps.Length - 1)];
            return Task.FromResult(step(request));
        }
    }
}
