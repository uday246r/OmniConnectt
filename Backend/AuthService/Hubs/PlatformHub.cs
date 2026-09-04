using System.IdentityModel.Tokens.Jwt;
using System.Text.Json;
using AuthService.Application.Services;
using AuthService.Infrastructure.Security;
using AuthService.Infrastructure.Seed;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace AuthService.Hubs;

/// <summary>
/// Central real-time SignalR Hub for the OmniRemit platform (/hubs/platform).
/// <para>
/// Security Notice:
/// Group membership is a JWT snapshot evaluated on connection in <see cref="OnConnectedAsync"/>.
/// Any subsequent permission revocation lags until client reconnects.
/// CloseOnAuthenticationExpiration (configured in Program.cs) bounds this exposure window
/// to the 15-minute token lifespan. The payload on broadcast channels is currently metadata-only
/// (topic and action with no PII/confidential data).
/// </para>
/// <para>
/// Coupled to PermissionClaimsBuilder: the "perms" claim it mints only carries capabilities that are
/// active AND typed <c>CapabilityType.Api</c>. Group membership below is therefore only as good as
/// that filter. Today the seeder leaves the approvals and audit-log capabilities untyped, which
/// defaults them to Api, so this works — but re-typing either of them to a UI-only capability would
/// silently stop non-administrators joining these groups, with no error anywhere: the permission
/// simply would not be in the token to find, so even the fail-closed catch below never runs.
/// </para>
/// </summary>
[Authorize]
public class PlatformHub : Hub
{
    public override async Task OnConnectedAsync()
    {
        var user = Context.User;
        if (user?.Identity?.IsAuthenticated != true)
        {
            Context.Abort();
            return;
        }

        var sub = user.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
        if (!Guid.TryParse(sub, out var userId))
        {
            Context.Abort();
            return;
        }

        // 1. Personal group for maker/checker notifications and badge count updates
        await Groups.AddToGroupAsync(Context.ConnectionId, $"user:{userId}");

        // 2. Evaluate administrative and permission claims (failing closed)
        var isAdministrator = user.FindFirst(JwtTokenService.AdministratorClaimType)?.Value == "true";
        var canViewApprovals = isAdministrator;
        var canViewAuditLogs = isAdministrator;

        if (!isAdministrator)
        {
            var permsClaim = user.FindFirst(JwtTokenService.PermissionsClaimType)?.Value;
            if (!string.IsNullOrEmpty(permsClaim))
            {
                try
                {
                    // Case-insensitive to match RequirePermissionAttribute. The push channel's
                    // fan-out must be exactly the REST read scope — if the two disagreed about
                    // casing, a user could be refused an event stream for data the API would
                    // happily serve them, or the reverse.
                    var permissions = new HashSet<string>(
                        JsonSerializer.Deserialize<string[]>(permsClaim) ?? [],
                        StringComparer.OrdinalIgnoreCase);

                    if (permissions.Contains($"{AuthDbSeeder.HostFeatureKeys.SystemApprovals}:View"))
                    {
                        canViewApprovals = true;
                    }
                    if (permissions.Contains($"{AuthDbSeeder.HostFeatureKeys.SystemAuditLogs}:View"))
                    {
                        canViewAuditLogs = true;
                    }
                }
                catch (JsonException)
                {
                    // Fail closed — an unparseable claim yields no viewer groups
                }
            }
        }

        if (canViewApprovals)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, "approvals.viewers");
        }

        if (canViewAuditLogs)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, "audit.viewers");
        }

        await base.OnConnectedAsync();
    }
}
