namespace backend.Infrastructure.Security;

/// <summary>
/// Claim type constants matching OmniConnect platform standards.
/// </summary>
public static class JwtClaimTypes
{
    public const string Subject = "sub";
    public const string Name = "name";
    public const string Email = "email";
    public const string Role = "role";
    public const string Permissions = "perms";
    /// <summary>Byte-for-byte the claim AuthService.Infrastructure.Security.JwtTokenService issues
    /// (JwtTokenService.AdministratorClaimType). Previously read "admin", a claim AuthService has
    /// never issued; RequiresCapabilityAttribute only worked because it also checked a hardcoded
    /// "administrator" literal alongside it. Corrected so the Super Admin bypass can rely on it.</summary>
    public const string Administrator = "administrator";
}
