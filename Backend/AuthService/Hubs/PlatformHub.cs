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
                    var permissions = JsonSerializer.Deserialize<string[]>(permsClaim) ?? [];
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
