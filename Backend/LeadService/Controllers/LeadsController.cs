using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LeadManagement.Api.Infrastructure;
using LeadManagement.Api.Infrastructure.Security;
using LeadManagement.Api.Models.Dtos;
using LeadManagement.Api.Services;

namespace LeadManagement.Api.Controllers
{
    [ApiController]
    [Route("api/leads")]
    [Route("api/v1/leads")]
    [Route("leads")]
    [Authorize]
    public class LeadsController : ControllerBase
    {
        private readonly ILeadService _leadService;
        private readonly AuthServiceClient _authServiceClient;

        public LeadsController(ILeadService leadService, AuthServiceClient authServiceClient)
        {
            _leadService = leadService;
            _authServiceClient = authServiceClient;
        }

        [HttpPost]
        [RequiresCapability("Lead", "Create")]
        public async Task<ActionResult<ApiResponseDto<LeadRecordDto>>> CreateLead([FromBody] CreateLeadDto dto)
        {
            if (!ModelState.IsValid)
            {
                var errors = ModelState
                    .Where(x => x.Value?.Errors.Count > 0)
                    .ToDictionary(
                        kvp => kvp.Key,
                        kvp => kvp.Value!.Errors.First().ErrorMessage
                    );

                return BadRequest(new ApiResponseDto<LeadRecordDto>
                {
                    Success = false,
                    Message = "Validation failed for lead submission.",
                    Errors = errors
                });
            }

            try
            {
                var outcome = await _leadService.CreateLeadAsync(dto, CurrentUserId(), bypassApproval: IsSuperAdmin());

                if (outcome.Pending is not null)
                {
                    // Gated: nothing was created. 202 Accepted — the request is understood and queued, not applied.
                    return StatusCode(202, new ApiResponseDto<ApprovalPendingDto>
                    {
                        Success = true,
                        Message = outcome.Pending.Message,
                        Data = outcome.Pending
                    });
                }

                var result = outcome.Applied!;

                // Push central platform audit log asynchronously
                await _authServiceClient.PushAuditLogAsync(
                    "lead.created", "Lead", result.Id,
                    $"Created lead for '{result.Name}' ({result.Product})",
                    CurrentUserId(), CurrentUserName(), result.Name,
                    module: "Leads", page: "create-lead", actionCategory: "CRUD");

                return CreatedAtAction(nameof(GetLeadById), new { id = result.Id }, new ApiResponseDto<LeadRecordDto>
                {
                    Success = true,
                    Message = "Lead submitted successfully.",
                    Data = result
                });
            }
            catch (ApprovalServiceUnavailableException ex)
            {
                // A gating check that couldn't be verified must block the mutation, not silently apply
                // it — never collapse this into the generic 500 branch below.
                return StatusCode(503, new ApiResponseDto<LeadRecordDto> { Success = false, Message = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                // A validation failure the service layer already produced a clear message for (unknown
                // product, a field-config Required/Editable violation) — 400, not a generic 500.
                return BadRequest(new ApiResponseDto<LeadRecordDto> { Success = false, Message = ex.Message });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponseDto<LeadRecordDto>
                {
                    Success = false,
                    Message = ex.Message
                });
            }
        }

        [HttpGet]
        [RequiresCapability("Lead", "View")]
        public async Task<ActionResult<ApiResponseDto<PagedResultDto<LeadRecordDto>>>> GetLeads(
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 10,
            [FromQuery] string? search = null,
            [FromQuery] string? product = null,
            [FromQuery] string? branch = null,
            [FromQuery] string? state = null,
            [FromQuery] string? salesExecutive = null,
            [FromQuery] string? month = null,
            [FromQuery] string? createdDate = null,
            [FromQuery] string? createdFrom = null,
            [FromQuery] string? createdTo = null,
            [FromQuery] string? name = null,
            [FromQuery] string? icNumber = null,
            [FromQuery] string? phone = null,
            [FromQuery] string? status = null,
            [FromQuery] string? leadSource = null)
        {
            var result = await _leadService.GetLeadsAsync(page, pageSize, search, product, branch, state, salesExecutive, month, createdDate, createdFrom, createdTo, name, icNumber, phone, status, leadSource);
            return Ok(new ApiResponseDto<PagedResultDto<LeadRecordDto>>
            {
                Success = true,
                Data = result
            });
        }

        [HttpGet("{id}")]
        [RequiresCapability("Lead", "View")]
        public async Task<ActionResult<ApiResponseDto<LeadRecordDto>>> GetLeadById(string id)
        {
            var lead = await _leadService.GetLeadByIdAsync(id);
            if (lead == null)
            {
                return NotFound(new ApiResponseDto<LeadRecordDto>
                {
                    Success = false,
                    Message = $"Lead with ID '{id}' was not found."
                });
            }

            return Ok(new ApiResponseDto<LeadRecordDto>
            {
                Success = true,
                Data = lead
            });
        }

        [HttpPut("{id}")]
        [RequiresCapability("Lead", "Edit")]
        public async Task<ActionResult<ApiResponseDto<LeadRecordDto>>> UpdateLead(string id, [FromBody] UpdateLeadDto dto)
        {
            if (!ModelState.IsValid)
            {
                var errors = ModelState
                    .Where(x => x.Value?.Errors.Count > 0)
                    .ToDictionary(
                        kvp => kvp.Key,
                        kvp => kvp.Value!.Errors.First().ErrorMessage
                    );

                return BadRequest(new ApiResponseDto<LeadRecordDto>
                {
                    Success = false,
                    Message = "Validation failed for lead update.",
                    Errors = errors
                });
            }

            try
            {
                var outcome = await _leadService.UpdateLeadAsync(id, dto, CurrentUserId(), bypassApproval: IsSuperAdmin());

                if (outcome.Pending is not null)
                {
                    return StatusCode(202, new ApiResponseDto<ApprovalPendingDto>
                    {
                        Success = true,
                        Message = outcome.Pending.Message,
                        Data = outcome.Pending
                    });
                }

                var updated = outcome.Applied!;

                // Push central platform audit log asynchronously
                await _authServiceClient.PushAuditLogAsync(
                    "lead.updated", "Lead", id,
                    $"Updated lead '{updated.Name}'",
                    CurrentUserId(), CurrentUserName(), updated.Name,
                    module: "Leads", page: "view-lead", actionCategory: "CRUD");

                return Ok(new ApiResponseDto<LeadRecordDto>
                {
                    Success = true,
                    Message = "Lead updated successfully.",
                    Data = updated
                });
            }
            catch (KeyNotFoundException ex)
            {
                return NotFound(new ApiResponseDto<LeadRecordDto>
                {
                    Success = false,
                    Message = ex.Message
                });
            }
            catch (ApprovalServiceUnavailableException ex)
            {
                return StatusCode(503, new ApiResponseDto<LeadRecordDto> { Success = false, Message = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new ApiResponseDto<LeadRecordDto> { Success = false, Message = ex.Message });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponseDto<LeadRecordDto>
                {
                    Success = false,
                    Message = ex.Message
                });
            }
        }

        [HttpDelete("{id}")]
        [RequiresCapability("Lead", "Delete")]
        public async Task<ActionResult<ApiResponseDto<bool>>> DeleteLead(string id, [FromBody] DeleteLeadDto dto)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(new ApiResponseDto<bool>
                {
                    Success = false,
                    Message = "Delete reason is required."
                });
            }

            try
            {
                // Captured before delete purely for the audit entry's friendly entity name — the
                // lead itself is gone from the DB by the time PushAuditLogAsync runs below.
                var leadName = (await _leadService.GetLeadByIdAsync(id))?.Name;

                var pending = await _leadService.DeleteLeadAsync(id, dto, CurrentUserId(), bypassApproval: IsSuperAdmin());
                if (pending is not null)
                {
                    return StatusCode(202, new ApiResponseDto<ApprovalPendingDto>
                    {
                        Success = true,
                        Message = pending.Message,
                        Data = pending
                    });
                }

                // Push central platform audit log asynchronously
                await _authServiceClient.PushAuditLogAsync(
                    "lead.deleted", "Lead", id,
                    $"Deleted lead (Reason: {dto.DeleteReason})",
                    CurrentUserId(), CurrentUserName(), leadName,
                    module: "Leads", page: "view-lead", actionCategory: "CRUD");

                return Ok(new ApiResponseDto<bool>
                {
                    Success = true,
                    Data = true,
                    Message = "This lead has been deleted."
                });
            }
            catch (KeyNotFoundException ex)
            {
                return NotFound(new ApiResponseDto<bool>
                {
                    Success = false,
                    Message = ex.Message
                });
            }
            catch (ApprovalServiceUnavailableException ex)
            {
                return StatusCode(503, new ApiResponseDto<bool> { Success = false, Message = ex.Message });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new ApiResponseDto<bool>
                {
                    Success = false,
                    Message = ex.Message
                });
            }
        }

        /// <summary>
        /// Records that a lead's full record was opened.
        /// </summary>
        /// <remarks>
        /// <para>
        /// This endpoint is the one client-initiated audit write left anywhere on the platform, and it
        /// is a different thing from the ones that were removed. Those took the action, the actor and
        /// the outcome from the request body and wrote whatever they were handed. This one takes only
        /// an id: the capability check, the actor and the description all come from the server, and
        /// the row cannot be written for a lead the caller is not allowed to read.
        /// </para>
        /// <para>
        /// It stays a separate call because a lead's detail view is assembled from data the list
        /// already returned, so there is no other request that means "this person opened this
        /// record". Viewing a specific customer's file is exactly the access an audit trail exists to
        /// record, which is why it is worth a request of its own rather than being dropped.
        /// </para>
        /// <para>
        /// Now dual-written. The local row backs Lead Management's own audit screen; the central push
        /// is new — views were the one Lead action that never reached the platform trail, so "what did
        /// this person look at across the platform" silently excluded every lead they opened.
        /// </para>
        /// </remarks>
        [HttpPost("{id}/view-audit")]
        [RequiresCapability("Lead", "View")]
        public async Task<ActionResult<ApiResponseDto<bool>>> LogLeadView(string id, CancellationToken ct)
        {
            var lead = await _leadService.GetLeadByIdAsync(id);
            if (lead is null)
            {
                return NotFound(new ApiResponseDto<bool>
                {
                    Success = false,
                    Message = $"Lead '{id}' was not found."
                });
            }

            await _leadService.LogLeadViewAsync(id);

            await _authServiceClient.PushAuditLogAsync(
                "lead.viewed", "Lead", id, $"Viewed the full record for lead '{lead.Name}'.",
                CurrentUserId(), CurrentUserName(), lead.Name,
                module: "Leads", page: "view-lead", actionCategory: "ViewDetails", ct: ct);

            return Ok(new ApiResponseDto<bool> { Success = true, Data = true });
        }

        private Guid? CurrentUserId()
        {
            var sub = User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value
                ?? User.FindFirst("sub")?.Value;
            return Guid.TryParse(sub, out var id) ? id : null;
        }

        private string? CurrentUserName() =>
            User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Name)?.Value
            ?? User.FindFirst("name")?.Value;

        /// <summary>
        /// Super Admin bypass predicate for the Maker-Checker gate. Deliberately the strict
        /// single-claim check — the exact claim AuthService issues — not this service's wider
        /// [RequiresCapability] admin test, so the population that skips assignment is identical
        /// across every service that has one of these helpers.
        /// </summary>
        private bool IsSuperAdmin() => User.FindFirst(JwtClaimTypes.Administrator)?.Value == "true";
    }
}
