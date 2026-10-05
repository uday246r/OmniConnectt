namespace LeadManagement.Api.Options;

public class ProductsIntegrationOptions
{
    public const string SectionName = "ProductsService";

    /// <summary>Base URL for ProductsService, e.g. http://localhost:5266.</summary>
    public string BaseUrl { get; set; } = string.Empty;

    /// <summary>
    /// The shared key ProductsService expects in X-Internal-Api-Key on its <c>internal/catalog</c>
    /// endpoints — the same value as that service's <c>Internal__CatalogApiKey</c>. It is deliberately NOT
    /// <c>Internal__ApiKey</c>: that one authorises AuthService replaying approvals, a write.
    /// </summary>
    public string InternalApiKey { get; set; } = string.Empty;
}
