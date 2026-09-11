namespace AuthService.Options;

/// <summary>
/// Bound from the "Internal" config section. The shared static key the other backend services must present
/// (via the X-Internal-Api-Key header) when pushing permission-feature upserts/deactivations.
/// A v1 simplification, not a substitute for mTLS/OAuth client-credentials in a hardened deployment.
/// </summary>
public class InternalApiOptions
{
    public const string SectionName = "Internal";

    public string ApiKey { get; set; } = string.Empty;
}
