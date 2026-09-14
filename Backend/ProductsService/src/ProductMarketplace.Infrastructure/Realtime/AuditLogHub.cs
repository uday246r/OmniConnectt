using Microsoft.AspNetCore.SignalR;

namespace ProductMarketplace.Infrastructure.Realtime;

/// <summary>Pushes newly created audit log entries to connected clients in real time.</summary>
public class AuditLogHub : Hub
{
}
