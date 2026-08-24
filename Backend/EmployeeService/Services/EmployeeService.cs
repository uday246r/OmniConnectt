using EmployeeService.DTOs;
using EmployeeService.DTOs.Requests;
using EmployeeService.DTOs.Responses;
using EmployeeService.Infrastructure;
using EmployeeService.Mappings;
using EmployeeService.Interfaces.IRepository;
using EmployeeService.Interfaces.IServices;
using EmployeeService.Options;
using Microsoft.Extensions.Options;

namespace EmployeeService.Services;

public class EmployeeService : IEmployeeService
{
    private readonly IEmployeeRepository _repository;
    private readonly AuthServiceClient _auditLog;
    private readonly SelfOptions _self;

    public EmployeeService(
        IEmployeeRepository repository,
        AuthServiceClient auditLog,
        IOptions<SelfOptions> selfOptions)
    {
        _repository = repository;
        _auditLog = auditLog;
        _self = selfOptions.Value;
    }

    /// <summary>
    /// Records this mutation as an approval request instead of applying it, when the module is gated.
    /// Returns null when the caller should proceed and mutate directly.
    ///
    /// Mirrors the same helper in LeadService and ModuleRegistry rather than sharing a package — each
    /// service owns its own copy deliberately, so no service can be broken by a change made for
    /// another. The three rules that matter are identical everywhere:
    ///
    ///  - `bypassApproval` is the replay path: an already-approved change must apply, not re-queue.
    ///  - A null actor means no identified maker, so there is nobody to attribute a request to.
    ///  - A failed SUBMIT throws. It must never fall through to applying the change, or making
    ///    AuthService unreachable would become a way to bypass approval altogether.
    /// </summary>
    private async Task<ApprovalPendingDto?> TrySubmitForApprovalAsync(
        string action, string? entityId, string entityLabel, string? oldDataJson, object requestBody,
        Guid? actorUserId, bool bypassApproval, string? entityKey = null)
    {
        if (bypassApproval || actorUserId is null)
        {
            return null;
        }

        if (!await _auditLog.IsGatedAsync(_self.EmployeeModuleKey))
        {
            return null;
        }

        var callbackUrl = $"{_self.PublicBaseUrl.TrimEnd('/')}/internal/approvals/apply";
        return await _auditLog.SubmitApprovalAsync(
            _self.EmployeeModuleKey, action, "Employee", entityId, entityLabel,
            oldDataJson, System.Text.Json.JsonSerializer.Serialize(requestBody), actorUserId.Value,
            callbackUrl, Guid.NewGuid().ToString(), entityKey: entityKey);
    }

    public async Task<EmployeeListResult> GetPagedAsync(EmployeeQuery query)
    {
        var (employees, total, departmentCount, averageSalary) = await _repository.GetPagedAsync(query);

        return new EmployeeListResult(
            employees.ToResponseList(),
            total,
            query.Page,
            query.PageSize,
            departmentCount,
            averageSalary);
    }

    public async Task<MutationResult<EmployeeResponse>> CreateAsync(
        CreateEmployeeRequest request, Guid? actorUserId, string? actorName, bool bypassApproval = false)
    {
        // A Create has no entity id yet, so it must supply a natural key or the
        // one-open-request-per-record guarantee does nothing for it: the dedupe key would fall back to
        // the null entity id, and Postgres treats NULLs as distinct, so two identical Create requests
        // could sit pending at once. Email is the natural identity here and is already unique.
        var pending = await TrySubmitForApprovalAsync(
            "Create", null, request.Name, null, request, actorUserId, bypassApproval,
            entityKey: $"employee:{request.Email.Trim().ToLowerInvariant()}");
        if (pending is not null)
        {
            return MutationResult<EmployeeResponse>.PendingApproval(pending);
        }

        var created = await _repository.CreateAsync(request.ToEntity());

        await _auditLog.PushAuditLogAsync(
            "employee.created", "Employee", created.Id.ToString(),
            $"Created employee '{created.Name}' ({created.Email}).", actorUserId, actorName, created.Name);

        return MutationResult<EmployeeResponse>.Ok(created.ToResponse());
    }

    public async Task<EmployeeResponse?> GetByIdAsync(Guid id)
    {
        var employee = await _repository.GetByIdAsync(id);
        return employee?.ToResponse();
    }

    public async Task<MutationResult<EmployeeResponse>?> UpdateAsync(
        Guid id, UpdateEmployeeRequest request, Guid? actorUserId, string? actorName, bool bypassApproval = false)
    {
        // Existence is checked BEFORE gating: queueing an approval for a record that does not exist
        // would give the maker a request that can only fail at replay time, long after they have gone.
        var existing = await _repository.GetByIdAsync(id);
        if (existing == null) return null;

        var oldSnapshot = System.Text.Json.JsonSerializer.Serialize(new { existing.Name, existing.Email });

        var pending = await TrySubmitForApprovalAsync(
            "Update", id.ToString(), existing.Name, oldSnapshot, request, actorUserId, bypassApproval);
        if (pending is not null)
        {
            return MutationResult<EmployeeResponse>.PendingApproval(pending);
        }

        var updated = await _repository.UpdateAsync(id, request.ToEntity());
        if (updated == null) return null;

        await _auditLog.PushAuditLogAsync(
            "employee.updated", "Employee", updated.Id.ToString(),
            $"Updated employee '{updated.Name}' ({updated.Email}).", actorUserId, actorName, updated.Name);

        return MutationResult<EmployeeResponse>.Ok(updated.ToResponse());
    }

    public async Task<MutationResult<bool>?> DeleteAsync(
        Guid id, Guid? actorUserId, string? actorName, bool bypassApproval = false)
    {
        var existing = await _repository.GetByIdAsync(id);
        if (existing == null) return null;

        var pending = await TrySubmitForApprovalAsync(
            "Delete", id.ToString(), existing.Name, null, new { Id = id }, actorUserId, bypassApproval);
        if (pending is not null)
        {
            return MutationResult<bool>.PendingApproval(pending);
        }

        var deleted = await _repository.DeleteAsync(id);
        if (!deleted) return null;

        await _auditLog.PushAuditLogAsync(
            "employee.deleted", "Employee", id.ToString(),
            $"Removed employee '{existing.Name}' ({existing.Email}).", actorUserId, actorName, existing.Name);

        return MutationResult<bool>.Ok(true);
    }
}
