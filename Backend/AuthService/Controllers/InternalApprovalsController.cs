using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Infrastructure.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AuthService.Controllers;

/// <summary>
/// Generic Maker-Checker gating surface for every OTHER service — mirrors InternalAuditLogsController's
/// shape exactly. Module-key-agnostic by construction: any remote's own PermissionFeature.Key works here
/// with zero AuthService code change, since ApprovalGatingService.IsGatedAsync/SubmitAsync only ever see
/// plain strings. AuthService writes its own User/Role approval requests in-process (see
/// UserAppService/RoleAppService); this is only for everyone else.
/// </summary>
[ApiController]
[Route("internal/approvals")]
[AllowAnonymous]
[TypeFilter(typeof(InternalApiKeyFilter))]
public class InternalApprovalsController(ApprovalGatingService gating) : ControllerBase
{
    [HttpGet("gated/{module}")]
    public async Task<IActionResult> Gated(string module, CancellationToken ct)
        => Ok(new { gated = await gating.IsGatedAsync(module, ct) });

    [HttpPost("submit")]
    public async Task<ActionResult<ApprovalPendingDto>> Submit([FromBody] SubmitInternalApprovalRequest request, CancellationToken ct)
    {
        var pending = await gating.SubmitAsync(
            request.Module, request.Action, request.EntityType, request.EntityId, request.EntityLabel,
            request.OldDataJson, request.NewDataJson, request.MakerId, ct,
            request.SourceService, request.CallbackUrl, request.CorrelationId, request.EntityKey);
        return Ok(pending);
    }
}
