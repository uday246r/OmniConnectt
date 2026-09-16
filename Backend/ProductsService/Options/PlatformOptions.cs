namespace ProductMarketplace.Api.Options;

/// <summary>Bound from "Jwt". The host platform's RS256 public key and the issuer/audience it signs for.</summary>
public class JwtValidationOptions
{
    public const string SectionName = "Jwt";

    /// <summary>PEM public key (SPKI or PKCS#1). Literal "\n" sequences are accepted from .env.</summary>
    public string? SigningKeyPublic { get; set; }

    public string Issuer { get; set; } = "omniremit-auth-service";

    public string Audience { get; set; } = "omniremit-host";
}

/// <summary>Bound from "AuthService". Where AuthService lives and the key this service presents to it.</summary>
public class AuthIntegrationOptions
{
    public const string SectionName = "AuthService";

    public string BaseUrl { get; set; } = string.Empty;

    /// <summary>This service's own internal key, sent as X-Internal-Api-Key.</summary>
    public string InternalApiKey { get; set; } = string.Empty;

    /// <summary>
    /// The name this service is known by to AuthService — the key of its entry under
    /// <c>Internal__Services__{ServiceName}</c> there, and the ServiceName on every audit row it pushes.
    /// </summary>
    public string ServiceName { get; set; } = "ProductsService";
}

/// <summary>Bound from "Internal". The key AuthService must present when replaying an approved change here.</summary>
public class InternalApiOptions
{
    public const string SectionName = "Internal";

    public string ApiKey { get; set; } = string.Empty;
}

/// <summary>Bound from "Self". How this remote identifies itself to the platform.</summary>
public class SelfOptions
{
    public const string SectionName = "Self";

    /// <summary>This service's externally reachable base URL, handed to AuthService as the replay callback.</summary>
    public string PublicBaseUrl { get; set; } = string.Empty;

    /// <summary>
    /// The key this app was registered under in Setup → Applications. Every permission it enforces is
    /// <c>remote.{AppKey}.{module}:{Capability}</c>, and every approval it files is for that module, so a
    /// different registration key needs only this value changed — no code.
    /// </summary>
    public string AppKey { get; set; } = "products";

    /// <summary>The application name shown on audit rows and in the host's Application filter.</summary>
    public string DisplayName { get; set; } = "Products & Marketplace";
}
