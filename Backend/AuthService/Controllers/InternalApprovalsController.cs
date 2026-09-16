using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Infrastructure.Security;
using AuthService.Options;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

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
public class InternalApprovalsController(ApprovalGatingService gating, IOptions<InternalApiOptions> internalOptions) : ControllerBase
{
    [HttpGet("gated/{module}")]
    public async Task<IActionResult> Gated(string module, CancellationToken ct)
        => Ok(new { gated = await gating.IsGatedAsync(module, ct) });

    [HttpPost("submit")]
    public async Task<ActionResult<ApprovalPendingDto>> Submit([FromBody] SubmitInternalApprovalRequest request, CancellationToken ct)
    {
        /*
         * A service identified by its own key acts only as itself.
         *
         * The body names the source service and the callback URL AuthService will later POST the
         * approved mutation to — along with that service's key. Trusting both from the body meant any
         * key holder could file a request as another service, or point the replay (and the key) at an
         * address of their choosing. The caller's identity now comes from the key, and the callback
         * must sit under that service's registered base URL.
         */
        var caller = InternalCaller.Get(HttpContext);
        var sourceService = caller ?? request.SourceService;

        var refusal = InternalCallbackPolicy.Check(internalOptions.Value, caller, request.CallbackUrl);
        if (refusal is not null)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new ProblemDetails
            {
                Title = refusal,
                Status = StatusCodes.Status403Forbidden,
            });
        }

        var pending = await gating.SubmitAsync(
            request.Module, request.Action, request.EntityType, request.EntityId, request.EntityLabel,
            request.OldDataJson, request.NewDataJson, request.MakerId, ct,
            sourceService, request.CallbackUrl, request.CorrelationId, request.EntityKey);
        return Ok(pending);
    }
}
