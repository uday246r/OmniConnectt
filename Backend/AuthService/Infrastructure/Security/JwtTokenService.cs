using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.Json;
using AuthService.Domain.Entities;
using AuthService.Options;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace AuthService.Infrastructure.Security;

public record AccessTokenResult(string Token, DateTimeOffset ExpiresAt);

/// <summary>
/// Issues short-lived RS256 access tokens. AuthService is the only service that ever touches the
/// private key; the public key is what the other services (and AuthService itself, for its own
/// [Authorize] endpoints) validates incoming tokens against.
/// </summary>
public class JwtTokenService(IOptions<JwtOptions> options)
{
    public const string AdministratorClaimType = "administrator";
    public const string PermissionsClaimType = "perms";
    public const string RoleNameClaimType = "role";
    /// <summary>Set from the LIVE User.MustChangePassword column on every token issuance. Both
    /// LoginAsync and RefreshAsync pass a freshly-read User entity (RefreshTokenService.RotateAsync
    /// loads it via Include, it never copies the previous token's claims), so this can never go
    /// stale: the first refresh after ChangePasswordAsync clears the flag issues a token without it.</summary>
    public const string MustChangePasswordClaimType = "mustChangePassword";

    private readonly JwtOptions _options = options.Value;

    public AccessTokenResult CreateAccessToken(User user, PermissionClaimsResult permissions)
    {
        if (string.IsNullOrWhiteSpace(_options.SigningKeyPrivate))
        {
            throw new InvalidOperationException(
                "Jwt:SigningKeyPrivate is not configured — set it in Backend/AuthService/.env before issuing tokens.");
        }

        using var rsa = RsaKeyLoader.LoadPrivateKey(_options.SigningKeyPrivate);
        var signingCredentials = new SigningCredentials(new RsaSecurityKey(rsa.ExportParameters(true)), SecurityAlgorithms.RsaSha256);

        var now = DateTimeOffset.UtcNow;
        var expiresAt = now.AddMinutes(_options.AccessTokenMinutes);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(JwtRegisteredClaimNames.Email, user.Email),
            new(JwtRegisteredClaimNames.Name, user.Name),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new(AdministratorClaimType, permissions.IsAdministrator ? "true" : "false"),
            new(PermissionsClaimType, JsonSerializer.Serialize(permissions.Permissions)),
            new(MustChangePasswordClaimType, user.MustChangePassword ? "true" : "false"),
        };

        if (user.RoleId is not null)
        {
            claims.Add(new Claim(RoleNameClaimType, user.RoleId.Value.ToString()));
        }

        var token = new JwtSecurityToken(
            issuer: _options.Issuer,
            audience: _options.Audience,
            claims: claims,
            notBefore: now.UtcDateTime,
            expires: expiresAt.UtcDateTime,
            signingCredentials: signingCredentials);

        var handler = new JwtSecurityTokenHandler();
        return new AccessTokenResult(handler.WriteToken(token), expiresAt);
    }
}
