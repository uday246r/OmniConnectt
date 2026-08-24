using System.Text.Json;
using EmployeeService.DTOs;
using EmployeeService.DTOs.Requests;
using EmployeeService.Infrastructure;
using EmployeeService.Infrastructure.Security;
using EmployeeService.Interfaces.IServices;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EmployeeService.Controllers;

/// <summary>
/// Replays an approved employee mutation. Called by AuthService only, once a checker has approved the
/// request this service originally submitted.
///
/// Not JWT-authenticated: at replay time there is no end-user request in flight, and the ambient
/// identity would be the checker's rather than the maker's anyway. The trust boundary is the shared
/// X-Internal-Api-Key, compared in constant time by <see cref="InternalApiKeyFilter"/>.
///
/// Every call passes bypassApproval: true. Without it the replay would re-submit the very request it
/// is applying and the change would never actually land.
///
/// Audit rows are attributed to the MAKER (request.ActingUserId), not the checker — the maker is who
/// made the change; the approval itself is recorded separately by AuthService.
/// </summary>
[ApiController]
[Route("internal/approvals")]
[AllowAnonymous]
[TypeFilter(typeof(InternalApiKeyFilter))]
public class InternalApprovalsController(IEmployeeService employees, AuthServiceClient authServiceClient) : ControllerBase
{
    [HttpPost("apply")]
    public async Task<IActionResult> Apply([FromBody] ApplyApprovedMutationRequest request)
    {
        switch (request.Action)
        {
            case "Create":
            {
                var dto = JsonSerializer.Deserialize<CreateEmployeeRequest>(
                    request.NewDataJson, JsonOptions)!;
                var created = await employees.CreateAsync(dto, request.ActingUserId, request.ActingUserName, bypassApproval: true);
                await authServiceClient.PushAuditLogAsync(
                    "employee.created", "Employee", created.Applied?.Id.ToString(),
                    $"Created employee '{created.Applied?.Name}'.",
                    request.ActingUserId, request.ActingUserName, created.Applied?.Name);
                break;
            }

            case "Update":
            {
                var dto = JsonSerializer.Deserialize<UpdateEmployeeRequest>(
                    request.NewDataJson, JsonOptions)!;
                var updated = await employees.UpdateAsync(
                    Guid.Parse(request.EntityId!), dto, request.ActingUserId, request.ActingUserName, bypassApproval: true);
                if (updated is null)
                {
                    // The record was removed between submission and approval. Reported rather than
                    // silently swallowed, so the failure is visible instead of looking like success.
                    return Conflict(new { message = "The employee no longer exists and the approved update could not be applied." });
                }
                await authServiceClient.PushAuditLogAsync(
                    "employee.updated", "Employee", request.EntityId,
                    $"Updated employee '{updated.Applied?.Name}'.",
                    request.ActingUserId, request.ActingUserName, updated.Applied?.Name);
                break;
            }

            case "Delete":
            {
                var deleted = await employees.DeleteAsync(
                    Guid.Parse(request.EntityId!), request.ActingUserId, request.ActingUserName, bypassApproval: true);
                if (deleted is null)
                {
                    return Conflict(new { message = "The employee no longer exists and the approved delete could not be applied." });
                }
                await authServiceClient.PushAuditLogAsync(
                    "employee.deleted", "Employee", request.EntityId,
                    "Removed employee.", request.ActingUserId, request.ActingUserName, null);
                break;
            }

            default:
                return BadRequest(new { message = $"No replay handler for action '{request.Action}'." });
        }

        return NoContent();
    }

    // The submitted body was serialised by this service with default (PascalCase) settings, but the
    // round trip through AuthService is JSON either way — case-insensitive matching makes the replay
    // independent of whichever casing convention is in play at each hop.
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };
}
