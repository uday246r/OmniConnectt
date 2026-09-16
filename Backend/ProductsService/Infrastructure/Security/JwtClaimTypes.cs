namespace ProductMarketplace.Api.Infrastructure.Security;

/// <summary>
/// Mirrors the claim type names AuthService.Infrastructure.Security.JwtTokenService embeds into
/// access tokens. Must stay byte-for-byte identical to that side's constants ("administrator", "perms").
/// </summary>
public static class JwtClaimTypes
{
    public const string Administrator = "administrator";
    public const string Permissions = "perms";
    public const string Role = "role";
    public const string Name = "name";
    public const string Email = "email";
    public const string Subject = "sub";
}
