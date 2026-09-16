using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LeadManagement.Api.Infrastructure;
using LeadManagement.Api.Infrastructure.Security;
using LeadManagement.Api.Models.Dtos;
using LeadManagement.Api.Services;

namespace LeadManagement.Api.Controllers
{
    [ApiController]
    [Route("api/auditlogs")]
    [Route("api/v1/auditlogs")]
    [Route("api/audit-logs")]
    [Route("api/v1/audit-logs")]
    [Authorize]
    public class AuditLogsController : ControllerBase
    {
        private readonly IAuditLogService _auditLogService;
        private readonly AuthServiceClient _authServiceClient;

        public AuditLogsController(IAuditLogService auditLogService, AuthServiceClient authServiceClient)
        {
            _auditLogService = auditLogService;
            _authServiceClient = authServiceClient;
        }

        /// <param name="from">
        /// Inclusive lower bound as an ISO 8601 instant. Named to match AuthService's audit and
        /// system-log endpoints, so one shared date-range control drives every log screen.
        /// </param>
        /// <param name="startDate">
        /// The old name for <paramref name="from"/>, kept so an existing caller does not break.
        /// It never worked correctly — see AuditLogService.BuildFilteredQuery — and nothing in this
        /// repository sends it, because no UI ever offered a date filter here.
        /// </param>
        [HttpGet]
        [RequiresCapability("AuditLog", "View")]
        public async Task<ActionResult<ApiResponseDto<PagedResultDto<AuditLogDto>>>> GetAuditLogs(
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 10,
            [FromQuery] string? search = null,
            [FromQuery] string? actionType = null,
            [FromQuery] string? entityId = null,
            [FromQuery] DateTimeOffset? from = null,
            [FromQuery] DateTimeOffset? to = null,
            [FromQuery] DateTimeOffset? startDate = null,
            [FromQuery] DateTimeOffset? endDate = null,
            [FromQuery] string? actor = null,
            [FromQuery] string? status = null,
            CancellationToken ct = default)
        {
            var result = await _auditLogService.GetAuditLogsAsync(
                page, pageSize, search, actionType, entityId, from ?? startDate, to ?? endDate, actor, status, ct);
            return Ok(new ApiResponseDto<PagedResultDto<AuditLogDto>>
            {
                Success = true,
                Data = result
            });
        }

        /// <summary>
        /// The current filtered result set as a CSV file.
        /// </summary>
        /// <remarks>
        /// <para>
        /// New. The Lead audit CSV was previously assembled in the browser from the page of rows
        /// already on screen — ten by default — so "export" produced a file containing whatever
        /// happened to be visible, under a name that claimed otherwise.
        /// </para>
        /// <para>
        /// Gated twice, deliberately. <c>AuditLog:View</c> because an export is a read of the trail,
        /// and <c>export.csv</c> because leaving the platform with a copy is a separate decision from
        /// being able to look at it on screen. That second capability used to be described in the
        /// manifest as "a UI gate, not a data boundary", which was accurate while the CSV was built
        /// client-side from rows the caller already held. It is a real boundary now, enforced here.
        /// </para>
        /// </remarks>
        [HttpGet("export")]
        [RequiresCapability("AuditLog", "View")]
        [RequiresFineCapability("AuditLog", "export.csv")]
        public async Task<IActionResult> ExportAuditLogs(
            [FromQuery] string? search = null,
            [FromQuery] string? actionType = null,
            [FromQuery] string? entityId = null,
            [FromQuery] DateTimeOffset? from = null,
            [FromQuery] DateTimeOffset? to = null,
            [FromQuery] string? actor = null,
            [FromQuery] string? status = null,
            CancellationToken ct = default)
        {
            var export = await _auditLogService.ExportAuditLogsCsvAsync(search, actionType, entityId, from, to, actor, status, ct);

            ExportHeaders.Apply(Response, export);

            await _authServiceClient.PushAuditLogAsync(
                "lead.audit_log.exported", "AuditLog", null,
                $"Exported {export.RowCount} audit row(s)" +
                (export.Truncated ? $" of {export.MatchCount} matching — the export limit of {export.RowLimit} was reached" : "") +
                $". Filters: {DescribeFilters(search, actionType, entityId, from, to, actor, status)}.",
                CurrentUserId(), CurrentUserName(), entityLabel: "Lead audit log",
                sourceApplication: "Lead Management", module: "Audit Logs", page: "audit-logs",
                actionCategory: "Export", ct: ct);

            return File(export.ToBytes(), "text/csv", $"lead-audit-logs-{DateTimeOffset.UtcNow:yyyyMMdd-HHmmss}.csv");
        }

        /// <summary>
        /// The filters, in the audit record. An export event that does not say WHAT was exported
        /// answers only half the question a reviewer is asking — "someone downloaded the audit log"
        /// is very different from "someone downloaded one lead's history".
        /// </summary>
        private static string DescribeFilters(
            string? search, string? actionType, string? entityId, DateTimeOffset? from, DateTimeOffset? to,
            string? actor, string? status)
        {
            var parts = new List<string>();
            if (!string.IsNullOrWhiteSpace(search)) parts.Add($"search='{search}'");
            if (!string.IsNullOrWhiteSpace(actionType)) parts.Add($"action={actionType}");
            if (!string.IsNullOrWhiteSpace(entityId)) parts.Add($"entity={entityId}");
            if (!string.IsNullOrWhiteSpace(actor)) parts.Add($"actor='{actor}'");
            if (!string.IsNullOrWhiteSpace(status)) parts.Add($"status={status}");
            if (from is not null) parts.Add($"from={from:O}");
            if (to is not null) parts.Add($"to={to:O}");
            return parts.Count == 0 ? "none (whole trail)" : string.Join(", ", parts);
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

        [HttpGet("{id}")]
        [RequiresCapability("AuditLog", "View")]
        public async Task<ActionResult<ApiResponseDto<AuditLogDto>>> GetAuditLogById(string id)
        {
            var log = await _auditLogService.GetAuditLogByIdAsync(id);
            if (log == null)
            {
                return NotFound(new ApiResponseDto<AuditLogDto>
                {
                    Success = false,
                    Message = $"Audit log with ID '{id}' was not found."
                });
            }

            return Ok(new ApiResponseDto<AuditLogDto>
            {
                Success = true,
                Data = log
            });
        }
    }
}
