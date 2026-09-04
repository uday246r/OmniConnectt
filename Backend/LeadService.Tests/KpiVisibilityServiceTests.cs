using System.Net;
using System.Security.Claims;
using System.Text;
using LeadManagement.Api.Infrastructure.Security;
using LeadManagement.Api.Models.Dtos;
using LeadManagement.Api.Options;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace LeadService.Tests;

/// <summary>
/// Withholding individual KPI cards from a response that carries three of them at once.
/// </summary>
/// <remarks>
/// Most fine-grained capabilities guard a whole endpoint and are refused by a filter before the
/// handler runs. Total Leads, New Leads and Converted cannot be: they are computed together in one
/// pass and returned in one object, so there is no separate request to refuse. Redacting the response
/// is the same guarantee reached differently — a caller who was not granted a card cannot obtain its
/// number, whether they ask through the dashboard or with curl.
/// </remarks>
public class KpiVisibilityServiceTests
{
    private const string Total = "remote.lead.dashboard:kpi.total-leads";
    private const string New = "remote.lead.dashboard:kpi.new-leads";
    private const string Converted = "remote.lead.dashboard:kpi.converted";

    [Fact]
    public async Task A_granted_card_keeps_its_number_and_its_trend()
    {
        var summary = FullSummary();

        await Build(New).RedactAsync(summary, User());

        Assert.Equal(7, summary.NewLeads);
        Assert.NotEmpty(summary.NewLeadsTrend);
    }

    [Fact]
    public async Task An_ungranted_card_is_withheld_along_with_its_trend()
    {
        // The trend matters as much as the number: leaving the sparkline behind would hand over the
        // shape of the very series being withheld.
        var summary = FullSummary();

        await Build(New).RedactAsync(summary, User());

        Assert.Null(summary.TotalLeads);
        Assert.Empty(summary.TotalLeadsTrend);
        Assert.Null(summary.ConvertedLeads);
        Assert.Empty(summary.ConvertedLeadsTrend);
    }

    [Fact]
    public async Task A_withheld_card_is_null_rather_than_zero()
    {
        /*
         * The distinction is the point of making these fields nullable. A card that legitimately reads
         * zero and a card the caller may not see are different facts, and returning 0 for the second
         * states something false about the business — an operator would read "no leads converted"
         * rather than "you were not granted this".
         */
        var summary = FullSummary();

        await Build().RedactAsync(summary, User());

        Assert.Null(summary.TotalLeads);
        Assert.Null(summary.NewLeads);
        Assert.Null(summary.ConvertedLeads);
    }

    [Fact]
    public async Task An_administrator_sees_everything_without_a_capability_lookup()
    {
        // Short-circuits on the claim alone, which also means an administrator is unaffected if the
        // capability resolver is momentarily unavailable.
        var summary = FullSummary();

        await Build().RedactAsync(summary, User(administrator: true));

        Assert.Equal(42, summary.TotalLeads);
        Assert.Equal(7, summary.NewLeads);
        Assert.Equal(3, summary.ConvertedLeads);
    }

    [Fact]
    public async Task All_three_granted_means_nothing_is_withheld()
    {
        var summary = FullSummary();

        await Build(Total, New, Converted).RedactAsync(summary, User());

        Assert.Equal(42, summary.TotalLeads);
        Assert.Equal(7, summary.NewLeads);
        Assert.Equal(3, summary.ConvertedLeads);
    }

    [Fact]
    public async Task A_token_with_no_usable_subject_gets_no_cards()
    {
        // Fails closed: nothing can be resolved, so nothing is shown. Showing all three because the
        // lookup could not run is the mistake this guards against.
        var summary = FullSummary();
        var identity = new ClaimsIdentity([new Claim(JwtClaimTypes.Administrator, "false")], "Test");

        await Build(Total, New, Converted).RedactAsync(summary, new ClaimsPrincipal(identity));

        Assert.Null(summary.TotalLeads);
        Assert.Null(summary.NewLeads);
        Assert.Null(summary.ConvertedLeads);
    }

    [Fact]
    public async Task An_unreachable_AuthService_withholds_every_card()
    {
        // The fail-closed path end to end: the client returns nothing, so the service shows nothing.
        var summary = FullSummary();
        var service = new KpiVisibilityService(UnreachableClient());

        await service.RedactAsync(summary, User());

        Assert.Null(summary.TotalLeads);
        Assert.Null(summary.NewLeads);
        Assert.Null(summary.ConvertedLeads);
    }

    [Fact]
    public async Task The_two_cards_with_their_own_endpoints_are_left_alone_here()
    {
        // In Progress and Conversion Rate are refused by [RequiresFineCapability] on their own
        // endpoints; this service must not also blank them out of a response it does not own.
        var summary = FullSummary();

        await Build().RedactAsync(summary, User());

        Assert.Equal(5, summary.InProgressLeads);
        Assert.Equal(12.5, summary.ConversionRate);
    }

    // ---------------------------------------------------------------- fixture

    private static KpiSummaryDto FullSummary() => new()
    {
        TotalLeads = 42,
        NewLeads = 7,
        InProgressLeads = 5,
        ConvertedLeads = 3,
        ConversionRate = 12.5,
        TotalLeadsTrend = [new KpiSparklinePointDto()],
        NewLeadsTrend = [new KpiSparklinePointDto()],
        ConvertedLeadsTrend = [new KpiSparklinePointDto()],
    };

    private static ClaimsPrincipal User(bool administrator = false)
    {
        var identity = new ClaimsIdentity(
            [
                new Claim(JwtClaimTypes.Subject, Guid.NewGuid().ToString()),
                new Claim(JwtClaimTypes.Administrator, administrator ? "true" : "false"),
            ],
            "Test");

        return new ClaimsPrincipal(identity);
    }

    private static KpiVisibilityService Build(params string[] granted) =>
        new(ClientReturning(granted));

    private static FineCapabilityClient ClientReturning(params string[] capabilities)
    {
        var body = System.Text.Json.JsonSerializer.Serialize(new { capabilities });
        return BuildClient(new StubHandler(() => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        }));
    }

    private static FineCapabilityClient UnreachableClient() =>
        BuildClient(new StubHandler(() => throw new HttpRequestException("connection refused")));

    private static FineCapabilityClient BuildClient(HttpMessageHandler handler) =>
        new(new HttpClient(handler),
            Options.Create(new AuthIntegrationOptions { BaseUrl = "http://auth.test", InternalApiKey = "k" }),
            new MemoryCache(new MemoryCacheOptions()),
            NullLogger<FineCapabilityClient>.Instance);

    private sealed class StubHandler(Func<HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            => Task.FromResult(respond());
    }
}
