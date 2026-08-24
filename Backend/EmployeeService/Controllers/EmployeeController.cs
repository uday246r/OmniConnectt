using EmployeeService.Common;
using EmployeeService.DTOs.Requests;
using EmployeeService.Infrastructure.Security;
using EmployeeService.Interfaces.IServices;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EmployeeService.Controllers;

/// <summary>
/// Local, zero-network-call authorization — [Authorize] validates the RS256 JWT the same way
/// ModuleRegistry does, and [RequiresCapability] reads the `perms` claim already embedded in that
/// token at login. No per-request round trip to AuthService, which is what used to couple this
/// service's uptime and latency to AuthService's.
/// </summary>
[ApiController]
[Route("api/employees")]
[Authorize]
public class EmployeesController : ControllerBase
{
    private readonly IEmployeeService _service;

    public EmployeesController(IEmployeeService service)
    {
        _service = service;
    }

    /// <summary>
    /// Reading the employee roster requires an explicit "View" grant.
    /// <para>
    /// This endpoint previously carried only the class-level [Authorize], which meant ANY
    /// authenticated user on the platform — including one holding zero remote.employee grants —
    /// could read every employee record, salary included, while Create/Edit/Delete were all
    /// correctly gated. Adding the attribute also makes "View" appear automatically in the host's
    /// Role editor, because the discovery endpoint reflects over exactly these attributes.
    /// </para>
    /// </summary>
    [HttpGet]
    [RequiresCapability("Employee", "View")]
    public async Task<IActionResult> GetEmployees([FromQuery] EmployeeQuery query)
    {
        var employees = await _service.GetPagedAsync(query);

        return Ok(new ApiResponse<object>
        {
            Success = true,
            Message = "Employees fetched successfully",
            Data = employees
        });
    }

    [HttpPost]
    [RequiresCapability("Employee", "Create")]
    public async Task<IActionResult> CreateEmployee(CreateEmployeeRequest request)
    {
        var result = await _service.CreateAsync(request, CurrentUserId(), CurrentUserName());

        // 202 with the pending payload when the module is under Maker-Checker. The host frontend's
        // isApprovalPending() guard reads this shape from every service, so the response is the same
        // whichever service gated the change.
        if (result.Pending is not null) return Accepted(result.Pending);

        return Ok(new ApiResponse<object>
        {
            Success = true,
            Message = "Employee created successfully",
            Data = result.Applied
        });
    }

    [HttpPut("{id}")]
    [RequiresCapability("Employee", "Edit")]
    public async Task<IActionResult> UpdateEmployee(Guid id, UpdateEmployeeRequest request)
    {
        var result = await _service.UpdateAsync(id, request, CurrentUserId(), CurrentUserName());
        if (result == null) return NotFound(new ApiResponse<object> { Success = false, Message = "Employee not found" });
        if (result.Pending is not null) return Accepted(result.Pending);

        return Ok(new ApiResponse<object>
        {
            Success = true,
            Message = "Employee updated successfully",
            Data = result.Applied
        });
    }

    [HttpDelete("{id}")]
    [RequiresCapability("Employee", "Delete")]
    public async Task<IActionResult> DeleteEmployee(Guid id)
    {
        var result = await _service.DeleteAsync(id, CurrentUserId(), CurrentUserName());
        if (result == null) return NotFound(new ApiResponse<object> { Success = false, Message = "Employee not found" });
        if (result.Pending is not null) return Accepted(result.Pending);

        return Ok(new ApiResponse<object>
        {
            Success = true,
            Message = "Employee deleted successfully"
        });
    }

    private Guid? CurrentUserId()
    {
        var sub = User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value;
        return Guid.TryParse(sub, out var id) ? id : null;
    }

    private string? CurrentUserName() =>
        User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Name)?.Value;
}
