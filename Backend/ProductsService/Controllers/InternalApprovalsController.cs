using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProductMarketplace.Api.Infrastructure.Approvals;
using ProductMarketplace.Api.Infrastructure.Security;
using ProductMarketplace.Api.Services;

namespace ProductMarketplace.Api.Controllers;

/// <summary>
/// Where AuthService sends an approved change back to be applied. Guarded by the internal key, never by
/// a user token — the caller is AuthService acting on a checker's decision.
/// </summary>
[ApiController]
[Route("internal/approvals")]
[AllowAnonymous]
[TypeFilter(typeof(InternalApiKeyFilter))]
public class InternalApprovalsController(IServiceProvider services, AuditActorOverride actorOverride) : ControllerBase
{
    public sealed record ApplyApprovedMutationRequest(
        string Module, string Action, string? EntityType, string? EntityId, string NewDataJson,
        Guid ActingUserId, string? ActingUserName, string? CorrelationId);

    [HttpPost("apply")]
    public async Task<IActionResult> Apply([FromBody] ApplyApprovedMutationRequest request, CancellationToken ct)
    {
        ApprovalGate.Envelope? envelope;
        try
        {
            envelope = JsonSerializer.Deserialize<ApprovalGate.Envelope>(request.NewDataJson, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        }
        catch (JsonException)
        {
            envelope = null;
        }

        if (envelope is null || ProductsMutations.Find(envelope.Operation) is null)
        {
            return BadRequest(new ProblemDetails { Title = "This approved change is not one this service can apply.", Status = 400 });
        }

        // Everything the replay writes — the local audit row and its central copy — names the maker.
        actorOverride.AttributeTo(request.ActingUserId, request.ActingUserName);

        await ProductsMutations.ApplyAsync(services, envelope.Operation, request.EntityId, envelope.Payload, ct);
        return NoContent();
    }
}
