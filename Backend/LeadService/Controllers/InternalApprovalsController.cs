using System.Text.Json;
using LeadManagement.Api.Infrastructure;
using LeadManagement.Api.Infrastructure.Security;
using LeadManagement.Api.Models.Dtos;
using LeadManagement.Api.Models.Entities;
using LeadManagement.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LeadManagement.Api.Controllers;

/// <summary>
/// Where AuthService replays an approved Lead mutation — the other half of
/// AuthServiceClient.SubmitApprovalAsync's CallbackUrl. Guarded by the same shared X-Internal-Api-Key
/// trust boundary as every internal endpoint in the platform, mirroring AuthService's own
/// InternalAuditLogsController shape exactly.
///
/// LeadsController pushes the central "lead.created"/"lead.updated"/"lead.deleted" audit entry itself
/// after a direct call succeeds — since a replay never goes through that controller, this endpoint
/// pushes the equivalent entry itself, attributed to the maker (request.ActingUserId/ActingUserName)
/// rather than whoever is signed in (there is no signed-in caller here — this is a service-to-service
/// call), matching AuthService's own "replayed audit row stays attributed to the maker" rule.
/// </summary>
[ApiController]
[Route("internal/approvals")]
[AllowAnonymous]
[TypeFilter(typeof(InternalApiKeyFilter))]
public class InternalApprovalsController(
    ILeadService leadService, AuthServiceClient authServiceClient, LeadFieldConfigService fieldConfigService,
    AuditActorContext auditActor) : ControllerBase
{
    [HttpPost("apply")]
    public async Task<IActionResult> Apply([FromBody] ApplyApprovedMutationRequest request)
    {
        /*
         * Attribute everything this replay writes to the MAKER.
         *
         * The request arrives from AuthService carrying the internal API key and no user token, so
         * the LOCAL audit rows written deep inside the lead services below have no caller to resolve
         * and would be recorded as unattributed. Setting the override once here covers every write
         * the replay performs, including those in code with no idea an approval is involved.
         *
         * The central rows pushed further down already name the maker explicitly; this makes the two
         * trails agree, so an approved change reads the same whether you look at Lead Management's
         * own audit screen or the platform's.
         */
        auditActor.AttributeTo(request.ActingUserId, request.ActingUserName);

        // LeadFieldConfig replays are also submitted with Action="Update" (see
        // LeadFieldConfigService.TrySubmitForApprovalAsync) — branch on EntityType FIRST so this never
        // collides with the Lead-update case in the switch below.
        if (request.EntityType == "LeadFieldConfig")
        {
            var productId = Guid.Parse(request.EntityId!);
            var fields = JsonSerializer.Deserialize<List<LeadFieldConfig>>(request.NewDataJson)!;
            await fieldConfigService.ReplaceAsync(productId, fields, request.ActingUserId, request.ActingUserName, bypassApproval: true);
            return NoContent();
        }

        switch (request.Action)
        {
            case "Create":
                var createDto = JsonSerializer.Deserialize<CreateLeadDto>(request.NewDataJson)!;
                var created = await leadService.CreateLeadAsync(createDto, request.ActingUserId, bypassApproval: true);
                await authServiceClient.PushAuditLogAsync(
                    "lead.created", "Lead", created.Applied!.Id, $"Created lead for '{created.Applied.Name}' ({created.Applied.Product})",
                    request.ActingUserId, request.ActingUserName, created.Applied.Name,
                    module: "Leads", page: "create-lead", actionCategory: "CRUD");
                break;

            case "Update":
                var updateDto = JsonSerializer.Deserialize<UpdateLeadDto>(request.NewDataJson)!;
                var updated = await leadService.UpdateLeadAsync(request.EntityId!, updateDto, request.ActingUserId, bypassApproval: true);
                await authServiceClient.PushAuditLogAsync(
                    "lead.updated", "Lead", request.EntityId, $"Updated lead '{updated.Applied!.Name}'",
                    request.ActingUserId, request.ActingUserName, updated.Applied.Name,
                    module: "Leads", page: "view-lead", actionCategory: "CRUD");
                break;

            case "Delete":
                var deleteDto = JsonSerializer.Deserialize<DeleteLeadDto>(request.NewDataJson)!;
                await leadService.DeleteLeadAsync(request.EntityId!, deleteDto, request.ActingUserId, bypassApproval: true);
                await authServiceClient.PushAuditLogAsync(
                    "lead.deleted", "Lead", request.EntityId, $"Deleted lead (Reason: {deleteDto.DeleteReason})",
                    request.ActingUserId, request.ActingUserName, null,
                    module: "Leads", page: "view-lead", actionCategory: "CRUD");
                break;

            default:
                return BadRequest(new { message = $"No replay handler for action '{request.Action}'." });
        }

        return NoContent();
    }
}
