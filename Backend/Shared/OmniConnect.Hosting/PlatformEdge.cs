using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using IPNetwork = System.Net.IPNetwork;

namespace OmniConnect.Hosting;

/// <summary>
/// The first two middlewares of every service: believe the reverse proxy about who called, then strip
/// the path prefix the service is published under.
/// </summary>
/// <remarks>
/// <para>
/// <b>Forwarded headers.</b> Behind a proxy, <c>Connection.RemoteIpAddress</c> is the proxy's address —
/// the same for every user — so the login rate limiter becomes one shared bucket and every audit row
/// records the infrastructure as the actor's origin. <c>X-Forwarded-For</c> fixes that, but only if the
/// service believes it from the proxy alone: believed from anyone, a caller simply writes their own
/// header and spoofs both their IP and the request scheme.
/// </para>
/// <para>
/// So the trusted senders come from <c>ForwardedHeaders:KnownNetworks</c> (comma-separated CIDRs, e.g.
/// the docker network <c>172.30.0.0/24</c>). When that is unset the old behaviour remains — trust any
/// sender — because a managed platform that assigns the proxy address dynamically has no CIDR to
/// configure; it is safe only while the container is reachable solely through that proxy, and outside
/// Development a warning says so on every start.
/// </para>
/// <para>
/// <b>Path base.</b> On a single public origin, each backend lives under its own prefix
/// (<c>/api/lead-service</c>, <c>/api/products-service</c>, ...). <c>Hosting:PathBase</c> sets it, with a
/// per-service default. <c>UsePathBase</c> also accepts the unprefixed path, so server-to-server callers
/// that address a service directly (capability discovery, the catalogue proxy) keep working unchanged.
/// It must run before authentication and routing: SignalR's token hook and every route see
/// <c>Request.Path</c> with the prefix already removed.
/// </para>
/// </remarks>
public static class PlatformEdge
{
    public const string KnownNetworksKey = "ForwardedHeaders:KnownNetworks";
    public const string PathBaseKey = "Hosting:PathBase";

    /// <summary>Forwarded headers, then the path base. Call first in the pipeline.</summary>
    public static WebApplication UsePlatformEdge(this WebApplication app, string defaultPathBase = "")
    {
        var options = BuildForwardedHeadersOptions(app.Configuration, out var trustsAnySender);
        if (trustsAnySender && !app.Environment.IsDevelopment())
        {
            app.Logger.LogWarning(
                "{Key} is not set, so X-Forwarded-For is believed from ANY sender. That is safe only while this " +
                "service is reachable solely through the platform's reverse proxy. Set it to the proxy's network " +
                "(e.g. the docker network CIDR) wherever that is known.", KnownNetworksKey);
        }
        app.UseForwardedHeaders(options);

        var pathBase = ResolvePathBase(app.Configuration[PathBaseKey], defaultPathBase);
        if (pathBase.HasValue)
        {
            app.UsePathBase(pathBase);
        }

        return app;
    }

    /// <summary>
    /// The forwarded-headers options for the given configuration. <paramref name="trustsAnySender"/> is
    /// true when no network is configured and every sender's headers are believed.
    /// </summary>
    public static ForwardedHeadersOptions BuildForwardedHeadersOptions(IConfiguration configuration, out bool trustsAnySender)
    {
        var options = new ForwardedHeadersOptions
        {
            ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
            // One proxy hop: nginx. A longer chain would let the caller's own X-Forwarded-For entries
            // through ahead of the address nginx observed.
            ForwardLimit = 1,
        };

        // The defaults trust loopback only; both lists are replaced, never appended to.
        options.KnownIPNetworks.Clear();
        options.KnownProxies.Clear();

        var networks = ParseNetworks(configuration[KnownNetworksKey]);
        foreach (var network in networks)
        {
            options.KnownIPNetworks.Add(network);
        }

        trustsAnySender = networks.Count == 0;
        return options;
    }

    /// <summary>
    /// Parses a comma-separated CIDR list. A malformed entry fails startup rather than being skipped:
    /// silently dropping the only entry would quietly fall back to trusting every sender.
    /// </summary>
    public static IReadOnlyList<IPNetwork> ParseNetworks(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return [];

        var result = new List<IPNetwork>();
        foreach (var raw in value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (!IPNetwork.TryParse(raw, out var network))
            {
                throw new InvalidOperationException(
                    $"{KnownNetworksKey} entry '{raw}' is not a CIDR network such as 172.30.0.0/24.");
            }
            result.Add(network);
        }
        return result;
    }

    /// <summary>
    /// The configured path base, or the service's default when unset. An explicitly empty value turns it
    /// off. Normalised to a leading slash and no trailing slash, which is the only shape PathString accepts.
    /// </summary>
    public static PathString ResolvePathBase(string? configured, string defaultPathBase)
    {
        var value = (configured ?? defaultPathBase).Trim();
        if (value.Length == 0 || value == "/") return PathString.Empty;

        value = "/" + value.Trim('/');
        if (value.Contains("//", StringComparison.Ordinal) || value.Contains('?') || value.Contains('#'))
        {
            throw new InvalidOperationException($"{PathBaseKey} '{configured}' is not a plain path such as /api/lead-service.");
        }
        return new PathString(value);
    }
}
