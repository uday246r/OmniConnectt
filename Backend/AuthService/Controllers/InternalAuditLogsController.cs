using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Infrastructure.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AuthService.Controllers;

/// <summary>
/// Generic audit-log ingestion for every OTHER service (LeadService, Customer360Service, any future
/// remote's backend) — the same shared static API key as the permission-feature sync endpoints, not
/// end-user JWTs. AuthService writes its own User/Role audit entries in-process, see
/// UserAppService/RoleAppService; this is only for everyone else.
/// </summary>
[ApiController]
[Route("internal/audit-logs")]
[AllowAnonymous]
[TypeFilter(typeof(InternalApiKeyFilter))]
public class InternalAuditLogsController(AuditLogAppService auditLog) : ControllerBase
{
    [HttpPost]
    public async Task<IActionResult> Record([FromBody] RecordAuditLogRequest request, CancellationToken ct)
    {
        // Prefer what the caller reports — it's the origin service's own request, which is where the
        // real end-user's IP/User-Agent actually lands (this controller's own HttpContext only ever
        // sees the calling microservice's server, not the original browser). Fall back to this
        // connection's own address only for an older caller that hasn't been updated to send them.
        var sourceIp = string.IsNullOrWhiteSpace(request.SourceIp)
            ? HttpContext.Connection.RemoteIpAddress?.ToString()
            : request.SourceIp;
        var userAgent = string.IsNullOrWhiteSpace(request.UserAgent)
            ? HttpContext.Request.Headers.UserAgent.ToString()
            : request.UserAgent;

        await auditLog.WriteAsync(
            serviceName: request.ServiceName, 
            actorUserId: request.ActorUserId, 
            actorName: request.ActorName, 
            action: request.Action,
            entityType: request.EntityType, 
            entityId: request.EntityId, 
            details: request.Details, 
            sourceIp: sourceIp,
            authMethod: request.AuthMethod, 
            result: request.Result, 
            userAgent: userAgent, 
            failureReason: request.FailureReason, 
            correlationId: request.CorrelationId,
            entityLabel: request.EntityLabel, 
            sourceApplication: request.SourceApplication, 
            module: request.Module, 
            page: request.Page, 
            actionCategory: request.ActionCategory, 
            ct: ct);
        return NoContent();
    }
}
