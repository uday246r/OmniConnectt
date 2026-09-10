using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Infrastructure.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AuthService.Controllers;

[ApiController]
[Route("internal/system-logs")]
[AllowAnonymous]
[TypeFilter(typeof(InternalApiKeyFilter))]
public class InternalSystemLogsController(SystemLogAppService systemLog) : ControllerBase
{
    [HttpPost]
    public async Task<IActionResult> Record([FromBody] RecordSystemLogRequest request, CancellationToken ct)
    {
        await systemLog.WriteAsync(
            request.Severity, request.ServiceName, request.EventCode, request.Message,
            request.Module, request.Environment, request.TenantId, request.UserId,
            request.CorrelationId, request.RequestId, request.StatusCode, request.StackTrace,
            request.Metadata, ct);
        return NoContent();
    }
}
