using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Security;
using AuthService.Infrastructure.Seed;
using AuthService.Options;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace AuthService.Controllers;

/// <summary>
/// The platform audit trail: reading it, summarising it, and taking a copy of it.
/// </summary>
/// <remarks>
/// <para>
/// There is deliberately no free-form write endpoint. There used to be — <c>POST /api/audit-logs/activity</c>,
/// which any signed-in user could call with a body naming any service, any module and any action,
/// carrying no permission requirement at all. A trail anyone can write into records what clients
/// choose to say rather than what the platform did.
/// </para>
/// <para>
/// Rows are written in-process by the services that perform the work, and by other services through
/// <see cref="InternalAuditLogsController"/>, which is API-key protected. The one thing a browser can
/// report is <see cref="RecordPageView"/>, and it can name only a route: who opened it comes from the
/// token, and whether it is a page they can open — and what it is called — comes from their own
/// navigation tree, so the row cannot say anything the platform would not have said itself.
/// </para>
/// <para>
/// Note that <see cref="List"/>, <see cref="Summary"/>, <see cref="Facets"/> and <see cref="Export"/>
/// all bind the SAME <see cref="AuditLogFilter"/>. That is not tidiness: the list and the export
/// previously took different filter sets, and the User detail page's "export this user's activity"
/// sent an <c>actorUserId</c> the export had no parameter for — so it silently exported the whole
/// platform's trail while reporting success.
/// </para>
/// </remarks>
[ApiController]
[Route("api/audit-logs")]
[Authorize]
public class AuditLogsController(AuditLogAppService auditLog, PageViewAuditService pageViews) : ControllerBase
{
    private const string Feature = AuthDbSeeder.HostFeatureKeys.SystemAuditLogs;

    public sealed record PageViewRequest(string? Path);

    /// <summary>
    /// Records that the signed-in person opened a page.
    /// </summary>
    /// <remarks>
    /// Needs no audit permission: everyone's page views are recorded, not only auditors'. 204 whether a
    /// row was written or an identical one from the last few seconds already covers it, so the browser
    /// has nothing to act on; 400 for a route that is not a page the caller can open.
    /// </remarks>
    [HttpPost("page-views")]
    [EnableRateLimiting(RateLimitPolicies.PageViews)]
    public async Task<IActionResult> RecordPageView([FromBody] PageViewRequest request, CancellationToken ct)
    {
        if (CurrentUserId() is not { } userId)
        {
            return Unauthorized();
        }

        var (permissions, isAdministrator) = TokenPermissions.Read(User);
        var outcome = await pageViews.RecordAsync(
            userId, CurrentUserName(), permissions, isAdministrator, request.Path,
            HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString() is { Length: > 0 } ua ? ua : null,
            ct);

        return outcome == PageViewOutcome.Refused
            ? Problem(title: "That is not a page you can open.", statusCode: StatusCodes.Status400BadRequest)
            : NoContent();
    }

    [HttpGet]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<PagedResult<AuditLogDto>>> List(
        [FromQuery] AuditLogFilter filter,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 25,
        [FromQuery] string? sortDir = null,
        CancellationToken ct = default)
        => Ok(await auditLog.ListAsync(Math.Max(page, 1), Math.Clamp(pageSize, 1, 2000), filter, sortDir, ct));

    [HttpGet("summary")]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<AuditLogSummaryDto>> Summary(
        [FromQuery] AuditLogFilter filter, CancellationToken ct = default)
        => Ok(await auditLog.SummaryAsync(filter, ct));

    /// <summary>
    /// The distinct values each bounded filter can take, under the filters already applied.
    /// </summary>
    /// <remarks>
    /// Exists so the Audit Logs page can offer real dropdown options once its filtering became
    /// server-side. It used to build those lists from whichever rows it had fetched, which meant a
    /// page of ten rows produced a ten-value dropdown — and, even with a large pre-fetch, offered
    /// values that the other active filters had already excluded.
    /// </remarks>
    [HttpGet("facets")]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<AuditLogFacetsDto>> Facets(
        [FromQuery] AuditLogFilter filter, CancellationToken ct = default)
        => Ok(await auditLog.FacetsAsync(filter, ct));

    /// <summary>
    /// The current filtered result set as a CSV file.
    /// </summary>
    /// <remarks>
    /// Writes its own audit row before returning. An export is the one read on this platform that
    /// produces a copy of the trail outside it, and the trail had no record of that ever happening —
    /// so "who has a copy of our audit log, and of which slice" was unanswerable.
    /// </remarks>
    [HttpGet("export")]
    [RequirePermission(Feature, "Export")]
    public async Task<IActionResult> Export(
        [FromQuery] AuditLogFilter filter,
        [FromQuery] string? sortDir = null,
        CancellationToken ct = default)
    {
        var export = await auditLog.ExportCsvAsync(filter, sortDir, ct);

        ExportHeaders.Apply(Response, export);

        await auditLog.WriteHostAsync(
            CurrentUserId(), CurrentUserName(), "audit_log.exported",
            AuditLogAppService.Modules.AuditLogs, AuditLogAppService.Categories.Export,
            entityType: "AuditLog", entityLabel: "Platform audit log",
            details: $"Exported {export.RowCount} audit row(s)" +
                     (export.Truncated
                         ? $" of {export.MatchCount} matching — the export limit of {export.RowLimit} was reached"
                         : "") +
                     $". Filters: {AuditFilterDescription.Describe(filter)}.",
            sourceIp: HttpContext.Connection.RemoteIpAddress?.ToString(),
            userAgent: Request.Headers.UserAgent.ToString() is { Length: > 0 } ua ? ua : null,
            page: "audit-logs", ct: ct);

        return File(export.ToBytes(), "text/csv", $"audit-logs-{DateTimeOffset.UtcNow:yyyyMMdd-HHmmss}.csv");
    }

    private Guid? CurrentUserId() =>
        Guid.TryParse(User.FindFirst("sub")?.Value, out var id) ? id : null;

    private string? CurrentUserName() =>
        User.FindFirst("name")?.Value ?? User.FindFirst("email")?.Value;
}
