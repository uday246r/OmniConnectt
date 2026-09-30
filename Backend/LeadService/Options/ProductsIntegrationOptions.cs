namespace LeadManagement.Api.Options;

public class ProductsIntegrationOptions
{
    public const string SectionName = "ProductsService";

    /// <summary>Base URL for ProductsService, e.g. http://localhost:5266.</summary>
    public string BaseUrl { get; set; } = string.Empty;

    /// <summary>
    /// The shared key ProductsService expects in X-Internal-Api-Key on its internal endpoints — the same
    /// value as that service's <c>Internal__ApiKey</c>.
    /// </summary>
    public string InternalApiKey { get; set; } = string.Empty;
}
