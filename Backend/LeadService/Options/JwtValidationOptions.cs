namespace LeadManagement.Api.Options;

public class JwtValidationOptions
{
    public const string SectionName = "Jwt";

    /// <summary>
    /// RS256 public key (PEM formatted, PKCS#1 or SubjectPublicKeyInfo/SPKI). Newlines may be
    /// escaped as literal "\n" sequences when supplied via .env.
    /// </summary>
    public string? SigningKeyPublic { get; set; }

    public string Issuer { get; set; } = "omniconnect-auth-service";

    public string Audience { get; set; } = "omniconnect-host";
}
