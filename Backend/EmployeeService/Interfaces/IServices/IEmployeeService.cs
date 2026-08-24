using EmployeeService.DTOs.Requests;
using EmployeeService.DTOs;
using EmployeeService.DTOs.Responses;

namespace EmployeeService.Interfaces.IServices;

public interface IEmployeeService
{
    Task<EmployeeListResult> GetPagedAsync(EmployeeQuery query);

    Task<EmployeeResponse?> GetByIdAsync(Guid id);

    Task<MutationResult<EmployeeResponse>> CreateAsync(CreateEmployeeRequest request, Guid? actorUserId, string? actorName, bool bypassApproval = false);

    Task<MutationResult<EmployeeResponse>?> UpdateAsync(Guid id, UpdateEmployeeRequest request, Guid? actorUserId, string? actorName, bool bypassApproval = false);

    /// <summary>Null when the employee does not exist. Otherwise a result whose Pending is set if the delete was gated.</summary>
    Task<MutationResult<bool>?> DeleteAsync(Guid id, Guid? actorUserId, string? actorName, bool bypassApproval = false);
}
