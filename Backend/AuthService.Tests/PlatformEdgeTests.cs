using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using OmniConnect.Hosting;
using Xunit;
using MsOptions = Microsoft.Extensions.Options.Options;

namespace AuthService.Tests;

/// <summary>
/// The edge every service shares: which senders' X-Forwarded-For is believed, the path prefix a service
/// is published under, and the container health probe.
/// </summary>
/// <remarks>
/// The client IP that comes out of this edge feeds the login rate limiter and every audit row. Believed
/// from anyone, a caller writes their own header and both become fiction — so these tests pin that a
/// configured proxy network is the only sender believed, that a malformed network fails loudly instead
/// of silently trusting everyone, and that the path base takes the one shape PathString accepts.
/// </remarks>
public class PlatformEdgeTests
{
    private static IConfiguration Config(params (string Key, string? Value)[] values) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(values.Select(v => new KeyValuePair<string, string?>(v.Key, v.Value)))
            .Build();

    private static async Task<IPAddress?> ClientIpSeenBehind(ForwardedHeadersOptions options, string sender, string forwardedFor)
    {
        IPAddress? seen = null;
        var middleware = new ForwardedHeadersMiddleware(
            context => { seen = context.Connection.RemoteIpAddress; return Task.CompletedTask; },
            NullLoggerFactory.Instance,
            MsOptions.Create(options));

        var http = new DefaultHttpContext();
        http.Connection.RemoteIpAddress = IPAddress.Parse(sender);
        http.Request.Headers["X-Forwarded-For"] = forwardedFor;
        await middleware.Invoke(http);
        return seen;
    }

    [Fact]
    public async Task A_sender_inside_the_configured_proxy_network_has_its_forwarded_client_ip_believed()
    {
        var options = PlatformEdge.BuildForwardedHeadersOptions(
            Config((PlatformEdge.KnownNetworksKey, "172.30.0.0/24")), out var trustsAnySender);

        var seen = await ClientIpSeenBehind(options, sender: "172.30.0.10", forwardedFor: "203.0.113.7");

        Assert.False(trustsAnySender);
        Assert.Equal(IPAddress.Parse("203.0.113.7"), seen);
    }

    [Fact]
    public async Task A_sender_outside_the_proxy_network_cannot_spoof_its_ip_with_a_forwarded_header()
    {
        var options = PlatformEdge.BuildForwardedHeadersOptions(
            Config((PlatformEdge.KnownNetworksKey, "172.30.0.0/24")), out _);

        var seen = await ClientIpSeenBehind(options, sender: "198.51.100.20", forwardedFor: "10.0.0.1");

        Assert.Equal(IPAddress.Parse("198.51.100.20"), seen);
    }

    [Fact]
    public async Task Only_the_hop_nginx_observed_is_used_when_a_caller_prepends_its_own_entries()
    {
        var options = PlatformEdge.BuildForwardedHeadersOptions(
            Config((PlatformEdge.KnownNetworksKey, "172.30.0.0/24")), out _);

        // A client sent "X-Forwarded-For: 10.9.9.9"; nginx appended the address it really saw.
        var seen = await ClientIpSeenBehind(options, sender: "172.30.0.10", forwardedFor: "10.9.9.9, 203.0.113.7");

        Assert.Equal(IPAddress.Parse("203.0.113.7"), seen);
    }

    [Fact]
    public void With_no_network_configured_every_sender_is_believed_and_the_caller_is_told_so()
    {
        var options = PlatformEdge.BuildForwardedHeadersOptions(Config(), out var trustsAnySender);

        Assert.True(trustsAnySender);
        Assert.Empty(options.KnownIPNetworks);
        Assert.Empty(options.KnownProxies);
    }

    [Fact]
    public void A_malformed_network_fails_startup_instead_of_silently_trusting_every_sender()
    {
        var error = Assert.Throws<InvalidOperationException>(() =>
            PlatformEdge.BuildForwardedHeadersOptions(Config((PlatformEdge.KnownNetworksKey, "172.30.0.0/24, not-a-cidr")), out _));

        Assert.Contains("not-a-cidr", error.Message);
    }

    [Theory]
    [InlineData(null, "/api/lead-service", "/api/lead-service")]
    [InlineData("api/products-service/", "", "/api/products-service")]
    [InlineData("", "/api/lead-service", "")]
    [InlineData("/", "/api/lead-service", "")]
    public void The_path_base_is_the_configured_value_or_the_default_in_the_one_shape_pathstring_accepts(
        string? configured, string fallback, string expected)
    {
        Assert.Equal(expected, PlatformEdge.ResolvePathBase(configured, fallback).Value ?? "");
    }

    [Fact]
    public void A_path_base_carrying_a_query_is_refused()
    {
        Assert.Throws<InvalidOperationException>(() => PlatformEdge.ResolvePathBase("/api/x?y=1", ""));
    }

    private sealed class StubHandler(HttpStatusCode status) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(new HttpResponseMessage(status));
    }

    private sealed class ThrowingHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            throw new HttpRequestException("Connection refused");
    }

    [Fact]
    public async Task The_container_probe_exits_zero_only_for_a_successful_answer()
    {
        Assert.Equal(0, await ContainerHealthProbe.ProbeAsync("http://127.0.0.1:8080/health/live", new StubHandler(HttpStatusCode.OK)));
        Assert.Equal(1, await ContainerHealthProbe.ProbeAsync("http://127.0.0.1:8080/health/live", new StubHandler(HttpStatusCode.ServiceUnavailable)));
        Assert.Equal(1, await ContainerHealthProbe.ProbeAsync("http://127.0.0.1:8080/health/live", new ThrowingHandler()));
    }
}
