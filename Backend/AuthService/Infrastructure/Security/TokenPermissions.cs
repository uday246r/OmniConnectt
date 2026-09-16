using System.Security.Claims;
using System.Text.Json;

namespace AuthService.Infrastructure.Security;

/// <summary>
/// The caller's permissions as their token states them.
/// </summary>
/// <remarks>
/// Fails closed, as the authorization filters do: a missing or unparseable <c>perms</c> claim is no
/// permissions at all, never everything.
/// </remarks>
public static class TokenPermissions
{
    public static (HashSet<string> Permissions, bool IsAdministrator) Read(ClaimsPrincipal user)
    {
        var isAdministrator = user.FindFirst(JwtTokenService.AdministratorClaimType)?.Value == "true";
        var claim = user.FindFirst(JwtTokenService.PermissionsClaimType)?.Value;

        if (string.IsNullOrEmpty(claim))
        {
            return ([], isAdministrator);
        }

        try
        {
            var permissions = (JsonSerializer.Deserialize<string[]>(claim) ?? [])
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            return (permissions, isAdministrator);
        }
        catch (JsonException)
        {
            return ([], isAdministrator);
        }
    }
}
