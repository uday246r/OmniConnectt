namespace AuthService.Options;

/// <summary>
/// Bound from the "Jwt" config section. Access tokens are signed RS256 — AuthService holds both
/// keys; every other service is only ever given the public one.
/// PEM values are expected with literal "\n" sequences (the common env-var-safe encoding for
/// multi-line PEM content) and are unescaped before parsing — see Security/RsaKeyLoader.
/// </summary>
public class JwtOptions
{
    public const string SectionName = "Jwt";

    public string Issuer { get; set; } = "omniconnect-auth-service";
    public string Audience { get; set; } = "omniconnect-host";
    public int AccessTokenMinutes { get; set; } = 15;
    public int RefreshTokenDays { get; set; } = 14;

    /// <summary>
    /// Hard cap on a single sign-in session, measured from the original login and unaffected by
    /// activity or by how many times the refresh token has rotated. After this the user must sign in
    /// again. Set to 0 to disable the cap entirely (sessions then slide indefinitely, the old
    /// behaviour). Eight hours matches a working day, which is the usual expectation for a
    /// back-office console.
    /// </summary>
    public int AbsoluteSessionHours { get; set; } = 8;
    public string SigningKeyPrivate { get; set; } = string.Empty;
    public string SigningKeyPublic { get; set; } = string.Empty;
}
