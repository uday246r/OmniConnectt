using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Security;
using AuthService.Infrastructure.Seed;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AuthService.Controllers;

/// <summary>
/// The centralized Approval Center — one source of truth across the whole platform. There is
/// deliberately no POST here to create a request: the only path to a new ApprovalRequest row is a
/// gated mutation elsewhere in the API (see ApprovalGatingService.SubmitAsync), so a client can never
/// fabricate an approval request unconnected to a real gated attempt.
/// </summary>
[ApiController]
[Route("api/approvals")]
[Authorize]
public class ApprovalsController(ApprovalAppService approvals, AuditLogAppService auditLog) : ControllerBase
{
    private const string Feature = AuthDbSeeder.HostFeatureKeys.SystemApprovals;

    [HttpGet]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<PagedResult<ApprovalRequestListItemDto>>> List(
        [FromQuery] ApprovalFilter filter,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 25,
        [FromQuery] bool assignedToMe = false,
        CancellationToken ct = default)
    {
        return Ok(await approvals.ListAsync(
            Math.Max(page, 1), Math.Clamp(pageSize, 1, 100), Scope(filter, assignedToMe), ct));
    }

    /// <summary>
    /// The Approval Center's dropdown options, under the filters already applied.
    /// </summary>
    [HttpGet("facets")]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<ApprovalFacetsDto>> Facets(
        [FromQuery] ApprovalFilter filter, [FromQuery] bool assignedToMe = false, CancellationToken ct = default)
        => Ok(await approvals.FacetsAsync(Scope(filter, assignedToMe), ct));

    /// <summary>
    /// Applies "assigned to me" from the caller's own identity, and discards any checker id the query
    /// string tried to supply — the queue a caller sees is never someone else's by naming them.
    /// </summary>
    private ApprovalFilter Scope(ApprovalFilter filter, bool assignedToMe) =>
        filter with { CheckerId = assignedToMe ? CurrentUserId() : null };

    /// <summary>
    /// The current filtered approval queue as a CSV file.
    /// </summary>
    /// <remarks>
    /// New. The Approval Center is the platform's record of every gated change and who decided it,
    /// and it was the only log-shaped screen with no export at all.
    /// </remarks>
    [HttpGet("export")]
    [RequirePermission(Feature, "Export")]
    public async Task<IActionResult> Export(
        [FromQuery] ApprovalFilter filter,
        [FromQuery] bool assignedToMe = false,
        CancellationToken ct = default)
    {
        filter = Scope(filter, assignedToMe);
        var export = await approvals.ExportCsvAsync(filter, ct);

        ExportHeaders.Apply(Response, export);

        await auditLog.WriteHostAsync(
            CurrentUserId(), CurrentUserName(), "approval.exported",
            AuditLogAppService.Modules.Approvals, AuditLogAppService.Categories.Export,
            entityType: "ApprovalRequest", entityLabel: "Approval queue",
            details: $"Exported {export.RowCount} approval request(s)" +
                     (export.Truncated
                         ? $" of {export.MatchCount} matching — the export limit of {export.RowLimit} was reached"
                         : "") +
                     $". {filter.Describe()}",
            sourceIp: HttpContext.Connection.RemoteIpAddress?.ToString(),
            userAgent: Request.Headers.UserAgent.ToString() is { Length: > 0 } ua ? ua : null,
            page: "approvals", ct: ct);

        return File(export.ToBytes(), "text/csv", $"approvals-{DateTimeOffset.UtcNow:yyyyMMdd-HHmmss}.csv");
    }

    /// <summary>
    /// "My Requests" — the maker dashboard. Deliberately NOT gated by the Approvals "View" capability:
    /// every authenticated user must be able to track their own submissions regardless of whether they
    /// hold Approval Center access, and this can never leak anyone else's requests since makerId is
    /// always the caller's own id, never client-supplied.
    /// </summary>
    [HttpGet("mine")]
    public async Task<ActionResult<PagedResult<ApprovalRequestListItemDto>>> ListMine(
        [FromQuery] ApprovalFilter filter, [FromQuery] int page = 1, [FromQuery] int pageSize = 25, CancellationToken ct = default)
    {
        var currentUserId = CurrentUserId();
        if (currentUserId is null) return Unauthorized();

        // Every filter the Approval Center has — but always narrowed to the caller's own requests. My
        // Requests used to take only a status and filter the rest within the one page it had fetched,
        // so a request on page three could not be found by searching for it.
        return Ok(await approvals.ListAsync(Math.Max(page, 1), Math.Clamp(pageSize, 1, 100), Mine(filter, currentUserId.Value), ct));
    }

    /// <summary>My Requests' dropdown options, drawn from the caller's own requests under the filters applied.</summary>
    [HttpGet("mine/facets")]
    public async Task<ActionResult<ApprovalFacetsDto>> MineFacets([FromQuery] ApprovalFilter filter, CancellationToken ct = default)
    {
        var currentUserId = CurrentUserId();
        if (currentUserId is null) return Unauthorized();
        return Ok(await approvals.FacetsAsync(Mine(filter, currentUserId.Value), ct));
    }

    /// <summary>Forces the maker to the caller, whatever the query string said; the checker filter is by name only.</summary>
    private static ApprovalFilter Mine(ApprovalFilter filter, Guid currentUserId) =>
        filter with { MakerId = currentUserId, MakerName = null, CheckerId = null };

    [HttpGet("{id:guid}")]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<ApprovalRequestDetailDto>> Get(Guid id, CancellationToken ct)
        => Ok(await approvals.GetAsync(id, ct));

    [HttpGet("summary")]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<ApprovalSummaryDto>> Summary(CancellationToken ct)
    {
        var currentUserId = CurrentUserId();
        if (currentUserId is null) return Unauthorized();
        return Ok(await approvals.SummaryAsync(currentUserId.Value, ct));
    }

    [HttpPost("{id:guid}/approve")]
    [RequirePermission(Feature, "Approve")]
    public async Task<ActionResult<ApprovalRequestDetailDto>> Approve(Guid id, CancellationToken ct)
    {
        var currentUserId = CurrentUserId();
        if (currentUserId is null) return Unauthorized();
        return Ok(await approvals.ApproveAsync(id, currentUserId.Value, IsSuperAdmin(), ct));
    }

    [HttpPost("{id:guid}/reject")]
    [RequirePermission(Feature, "Approve")]
    public async Task<ActionResult<ApprovalRequestDetailDto>> Reject(Guid id, [FromBody] RejectApprovalRequest request, CancellationToken ct)
    {
        var currentUserId = CurrentUserId();
        if (currentUserId is null) return Unauthorized();
        return Ok(await approvals.RejectAsync(id, currentUserId.Value, request.Reason, IsSuperAdmin(), ct));
    }

    private Guid? CurrentUserId()
    {
        var sub = User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value;
        return Guid.TryParse(sub, out var id) ? id : null;
    }

    private string? CurrentUserName() =>
        User.FindFirst("name")?.Value ?? User.FindFirst("email")?.Value;

    /// <summary>
    /// Super Admin bypass predicate for the Maker-Checker gate. Deliberately the strict single-claim
    /// check — the exact claim AuthService issues — not a wider admin test, so the population that
    /// skips assignment is identical across every service that has one of these helpers.
    /// </summary>
    private bool IsSuperAdmin() => User.FindFirst(JwtTokenService.AdministratorClaimType)?.Value == "true";
}
