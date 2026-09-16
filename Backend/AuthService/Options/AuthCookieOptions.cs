namespace AuthService.Options;

/// <summary>Bound from the "Auth" config section — controls how the httpOnly refresh-token cookie is issued.</summary>
public class AuthCookieOptions
{
    public const string SectionName = "Auth";

    public string RefreshCookieName { get; set; } = "omniconnect_refresh";

    /// <summary>
    /// Leave empty for localhost development (browser infers the current host).
    /// <para>
    /// Leave it empty in production too, unless you genuinely need the cookie shared across
    /// subdomains. Setting ".example.com" sends the refresh token to EVERY subdomain, including the
    /// statically-hosted frontends, which have no use for it — a host-only cookie on the API's own
    /// domain is the tighter default.
    /// </para>
    /// </summary>
    public string RefreshCookieDomain { get; set; } = string.Empty;

    /// <summary>
    /// SameSite mode for the refresh cookie: "Lax" (default), "Strict", or "None".
    /// <para>
    /// Configurable because the correct value depends entirely on where the frontend is deployed,
    /// which is not knowable at build time. When the SPA and this API share a registrable domain
    /// (app.example.com calling api.example.com) the request is same-site and the default "Lax" is
    /// both correct and the safest option.
    /// </para>
    /// <para>
    /// "None" is required only when they are genuinely cross-site — e.g. a frontend on *.vercel.app
    /// calling an API on another domain. Without it the browser silently withholds the cookie on
    /// refresh, which presents as a successful login that drops the session moments later. "None"
    /// also mandates Secure (enforced below) and depends on third-party cookies, which browsers are
    /// progressively restricting, so prefer a shared parent domain where you can.
    /// </para>
    /// </summary>
    public string SameSite { get; set; } = "Lax";
}
