namespace backend.Options;

/// <summary>Bound from the "AuthService" section — how this service reaches AuthService's central
/// audit-log and Maker-Checker gating/submission internal endpoints. Mirrors LeadService's/
/// LeadService's own AuthIntegrationOptions exactly; this service never had one before Phase 2.</summary>
public class AuthIntegrationOptions
{
    public const string SectionName = "AuthService";

    /// <summary>Base URL for AuthService, e.g. http://localhost:5155.</summary>
    public string BaseUrl { get; set; } = string.Empty;

    /// <summary>Shared static API key passed in the X-Internal-Api-Key header.</summary>
    public string InternalApiKey { get; set; } = string.Empty;
}
