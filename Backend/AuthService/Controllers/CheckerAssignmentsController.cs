using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Infrastructure.Security;
using AuthService.Infrastructure.Seed;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AuthService.Controllers;

/// <summary>
/// Admin-only: maps modules to their eligible checkers. This is the one central configuration surface
/// for the whole Maker-Checker system — "one Checker Assignment setup for the entire platform" per the
/// requirement. Manage requires its own, narrower capability than the Approvals feature's own
/// View/Approve, so an ordinary checker can see who else is assigned (View) without being able to
/// reassign checkers (Manage) themselves.
/// </summary>
[ApiController]
[Route("api/checker-assignments")]
[Authorize]
public class CheckerAssignmentsController(CheckerAssignmentAppService assignments) : ControllerBase
{
    private const string Feature = AuthDbSeeder.HostFeatureKeys.SystemCheckerAssignment;

    [HttpGet]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<IReadOnlyList<CheckerAssignmentDto>>> List([FromQuery] string? module, CancellationToken ct)
        => Ok(await assignments.ListAsync(module, ct));

    /// <summary>Every module currently assignable a checker — AuthService's own Users/Roles plus every
    /// active PermissionFeature from the same live catalog the Role editor renders. Sources the Checker
    /// Assignment picker AND the Approval Center's module filter, so both stay in sync with whatever
    /// remote apps are actually registered, with zero code change here as new ones are added.</summary>
    [HttpGet("modules")]
    [RequirePermission(Feature, "View")]
    public async Task<ActionResult<IReadOnlyList<AssignableModuleDto>>> Modules(CancellationToken ct)
        => Ok(await assignments.GetAssignableModulesAsync(ct));

    [HttpPost]
    [RequirePermission(Feature, "Manage")]
    public async Task<ActionResult<CheckerAssignmentDto>> Upsert([FromBody] UpsertCheckerAssignmentRequest request, CancellationToken ct)
        => Ok(await assignments.UpsertAsync(request.Module, request.CheckerUserId, request.CheckerRoleId, CurrentUserId(), ct));

    /// <summary>Assigns one checker to every module named in the request in a single call — "assign one
    /// checker for a whole application at once" instead of repeating the single-module Upsert per module.</summary>
    [HttpPost("bulk")]
    [RequirePermission(Feature, "Manage")]
    public async Task<ActionResult<IReadOnlyList<CheckerAssignmentDto>>> BulkUpsert([FromBody] BulkUpsertCheckerAssignmentRequest request, CancellationToken ct)
        => Ok(await assignments.BulkUpsertAsync(request.Modules, request.CheckerUserId, request.CheckerRoleId, CurrentUserId(), ct));

    [HttpDelete("{id:guid}")]
    [RequirePermission(Feature, "Manage")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await assignments.DeleteAsync(id, CurrentUserId(), ct);
        return NoContent();
    }

    private Guid? CurrentUserId()
    {
        var sub = User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value;
        return Guid.TryParse(sub, out var id) ? id : null;
    }
}
