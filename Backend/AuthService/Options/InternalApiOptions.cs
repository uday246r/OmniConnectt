namespace AuthService.Options;

/// <summary>
/// Bound from the "Internal" config section: the credentials other backend services present in the
/// <c>X-Internal-Api-Key</c> header when they call AuthService's <c>/internal</c> routes, and that
/// AuthService presents back when it replays an approved mutation into them.
/// </summary>
/// <remarks>
/// <para>
/// One key per service, under <see cref="Services"/>, keyed by the service's name — the same name it
/// writes as <c>SourceService</c> on approval requests and <c>ServiceName</c> on audit rows:
/// <code>
/// Internal__Services__LeadService__ApiKey=...
/// Internal__Services__LeadService__CallbackBaseUrl=http://localhost:5046/api/lead-service
/// </code>
/// </para>
/// <para>
/// This replaces a single key shared by every service. With one shared key a leak anywhere was a leak
/// everywhere, rotating it meant redeploying the whole platform at once, and AuthService could not tell
/// which service was calling — so any holder could submit approvals, write audit rows or name a replay
/// callback URL on behalf of any other service. A per-service key identifies the caller, which lets
/// AuthService stamp its name onto what it writes and restrict where its replays may be sent.
/// </para>
/// <para>
/// <see cref="ApiKey"/> is the legacy shared key. It is honoured only while no per-service key is
/// configured, so an existing deployment keeps working until it is migrated, and stops being accepted
/// the moment the first per-service key is added.
/// </para>
/// </remarks>
public class InternalApiOptions
{
    public const string SectionName = "Internal";

    /// <summary>Legacy shared key. Ignored once any entry exists in <see cref="Services"/>.</summary>
    public string ApiKey { get; set; } = string.Empty;

    /// <summary>Per-service credentials, keyed by service name (case-insensitive).</summary>
    public Dictionary<string, InternalServiceCredential> Services { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>True once per-service keys are in use, which retires the legacy shared key.</summary>
    public bool UsesPerServiceKeys => Services.Values.Any(s => !string.IsNullOrWhiteSpace(s.ApiKey));
}

/// <summary>One service's internal credential.</summary>
public class InternalServiceCredential
{
    public string ApiKey { get; set; } = string.Empty;

    /// <summary>
    /// The base URL this service's replay endpoint must live under. An approval submitted by this
    /// service may only name a callback URL beneath it, so a caller cannot direct AuthService to post
    /// an approved mutation — and this service's key — to an address of its choosing. Optional: when
    /// unset, any http(s) callback is accepted for this service.
    /// </summary>
    public string? CallbackBaseUrl { get; set; }
}
