using Microsoft.AspNetCore.SignalR;

namespace ProductMarketplace.Infrastructure.Realtime;

/// <summary>Pushes newly created audit log entries to signed-in audit viewers in real time.</summary>
/// <remarks>
/// Authentication is required by the endpoint mapping in Program.cs; whether a connection may join the
/// viewers group is decided by <see cref="IAuditViewerPolicy"/>, which the API layer implements from
/// the caller's platform permissions. A connection that may not view the audit trail stays connected
/// but receives nothing.
/// </remarks>
public class AuditLogHub(IAuditViewerPolicy policy) : Hub
{
    public const string ViewersGroup = "audit-viewers";

    public override async Task OnConnectedAsync()
    {
        if (Context.User is not null && policy.CanView(Context.User))
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, ViewersGroup);
        }

        await base.OnConnectedAsync();
    }
}

/// <summary>Decides whether a hub connection may receive live audit entries.</summary>
public interface IAuditViewerPolicy
{
    bool CanView(System.Security.Claims.ClaimsPrincipal user);
}
