using AuthService.Application.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AuthService.Controllers;

[ApiController]
[Route("api/audit-logs/activity")]
[Authorize]
public class UserActivityController(AuditLogAppService auditLog) : ControllerBase
{
    public record ActivityEvent(
        string Page,
        string? Module = null,
        string? SourceApplication = null,
        string? Action = null,
        string? ActionCategory = null,
        string? PageLabel = null,
        string? Details = null,
        string? EntityType = null,
        string? EntityId = null,
        string? EntityLabel = null);

    [HttpPost]
    public async Task<IActionResult> Record([FromBody] ActivityEvent evt, CancellationToken ct)
    {
        var subClaim = HttpContext.User.FindFirst("sub")?.Value
            ?? HttpContext.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
            ?? HttpContext.User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value;
        var userId = Guid.TryParse(subClaim, out var parsed) ? (Guid?)parsed : null;
        var userName = HttpContext.User.FindFirst("name")?.Value
            ?? HttpContext.User.FindFirst(System.Security.Claims.ClaimTypes.Name)?.Value;

        var action = evt.Action ?? "page.viewed";
        var isDetails = action.Contains("details", StringComparison.OrdinalIgnoreCase);
        var category = evt.ActionCategory ?? (isDetails ? "ViewDetails" : "Navigation");
        var sourceApp = evt.SourceApplication ?? "Host";
        var pageLabel = evt.PageLabel ?? evt.Page;

        var entityType = evt.EntityType ?? (isDetails ? "RecordDetails" : "Page");
        var entityLabel = evt.EntityLabel ?? (category == "Navigation"
            ? (string.IsNullOrWhiteSpace(evt.Module) || string.Equals(evt.Module, pageLabel, StringComparison.OrdinalIgnoreCase)
                ? pageLabel
                : $"{evt.Module} — {pageLabel}")
            : pageLabel);

        var details = evt.Details ?? (isDetails
            ? $"Viewed details for {entityLabel}"
            : $"Navigated to {entityLabel}");

        var sourceIp = HttpContext.Connection.RemoteIpAddress?.ToString();
        var userAgent = HttpContext.Request.Headers.UserAgent.ToString();

        await auditLog.WriteAsync(
            serviceName: sourceApp, 
            actorUserId: userId, 
            actorName: userName, 
            action: action,
            entityType: entityType, 
            entityId: evt.EntityId ?? evt.Page, 
            details: details,
            sourceIp: sourceIp, 
            authMethod: null, 
            result: "Success",
            userAgent: userAgent, 
            failureReason: null, 
            correlationId: null, 
            entityLabel: entityLabel,
            sourceApplication: sourceApp,
            module: evt.Module, 
            page: evt.Page, 
            actionCategory: category,
            ct: ct);

        return NoContent();
    }
}
