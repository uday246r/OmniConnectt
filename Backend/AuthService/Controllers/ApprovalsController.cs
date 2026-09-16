using AuthService.Application.DTOs;
using AuthService.Application.Services;
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
public class ApprovalsController(ApprovalAppService approvals) : ControllerBase
{
    private const string Feature = AuthDbSeeder.HostFeatureKeys.SystemApprovals;

    [HttpGet]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<PagedResult<ApprovalRequestListItemDto>>> List(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 25,
        [FromQuery] string? module = null,
        [FromQuery] string? status = null,
        [FromQuery] Guid? makerId = null,
        [FromQuery] bool assignedToMe = false,
        [FromQuery] DateTimeOffset? from = null,
        [FromQuery] DateTimeOffset? to = null,
        CancellationToken ct = default)
    {
        var checkerId = assignedToMe ? CurrentUserId() : null;
        return Ok(await approvals.ListAsync(Math.Max(page, 1), Math.Clamp(pageSize, 1, 100), module, status, makerId, checkerId, from, to, ct));
    }

    /// <summary>
    /// "My Requests" — the maker dashboard. Deliberately NOT gated by the Approvals "View" capability:
    /// every authenticated user must be able to track their own submissions regardless of whether they
    /// hold Approval Center access, and this can never leak anyone else's requests since makerId is
    /// always the caller's own id, never client-supplied.
    /// </summary>
    [HttpGet("mine")]
    public async Task<ActionResult<PagedResult<ApprovalRequestListItemDto>>> ListMine(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 25, [FromQuery] string? status = null, CancellationToken ct = default)
    {
        var currentUserId = CurrentUserId();
        if (currentUserId is null) return Unauthorized();
        return Ok(await approvals.ListAsync(Math.Max(page, 1), Math.Clamp(pageSize, 1, 100), module: null, status, makerId: currentUserId, checkerId: null, from: null, to: null, ct));
    }

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

    /// <summary>
    /// One-time collection of the temporary password created when THIS maker's Create-User request
    /// was approved. Deliberately un-permissioned for the same reason as GET mine above: every user
    /// must be able to collect a credential for an account they themselves created. Ownership is
    /// enforced server-side against the caller's own token id — see RevealTempPasswordAsync.
    /// </summary>
 
    private Guid? CurrentUserId()
    {
        var sub = User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value;
        return Guid.TryParse(sub, out var id) ? id : null;
    }

    /// <summary>
    /// Super Admin bypass predicate for the Maker-Checker gate. Deliberately the strict single-claim
    /// check — the exact claim AuthService issues — not a wider admin test, so the population that
    /// skips assignment is identical across every service that has one of these helpers.
    /// </summary>
    private bool IsSuperAdmin() => User.FindFirst(JwtTokenService.AdministratorClaimType)?.Value == "true";
}
