namespace AuthService.Options;

/// <summary>
/// Where remote micro-frontends are served from, and how a release of one reaches users.
/// </summary>
/// <remarks>
/// On the platform's single public origin every remote is served by the same web server as the host,
/// under <c>/modules/&lt;key&gt;/&lt;version&gt;/</c>, and its registered manifest URL is that root-relative
/// path. The browser resolves it against the page; AuthService — which also fetches the manifest, to
/// probe health and read the container name — resolves it against <see cref="InternalBaseUrl"/>.
/// </remarks>
public class RemoteAppsOptions
{
    public const string SectionName = "RemoteApps";

    /// <summary>
    /// The web server's address as seen from AuthService, used to fetch root-relative manifest URLs:
    /// <c>http://web-internal:8080</c> inside docker compose, <c>http://127.0.0.1:5173</c> (the host dev
    /// server's proxy) in local development. Unset, a relative manifest URL cannot be probed and the
    /// app is reported unreachable with an error that says so.
    /// </summary>
    public string? InternalBaseUrl { get; set; }

    /// <summary>
    /// Whether a manifest URL may be absolute (<c>https://other-host/mf-manifest.json</c>). Null — the
    /// default — means "only in Development". Production keeps it off: every remote is served from the
    /// platform's own origin, and an absolute URL is also an address AuthService will fetch from inside
    /// the private network, which an administrator account should not be able to aim anywhere.
    /// </summary>
    public bool? AllowAbsoluteManifestUrls { get; set; }

    /// <summary>
    /// Built-in remotes' capability endpoints, by app key — e.g. <c>RemoteApps:BuiltIn:lead</c> =
    /// <c>http://lead:8080/api/lead-service/permissions</c>. Server-to-server addresses that differ per
    /// environment, which is why they are configuration rather than code.
    /// </summary>
    public Dictionary<string, string> BuiltIn { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}
