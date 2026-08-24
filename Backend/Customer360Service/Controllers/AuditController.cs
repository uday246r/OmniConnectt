using System;
using System.Collections.Generic;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using backend.Data;
using backend.Infrastructure.Security;
using backend.Models;

namespace backend.Controllers
{
    /*
     * NOTE the capability attributes are per-ACTION here, not on the class.
     *
     * Reading the audit trail and writing to it are different privileges with different audiences.
     * A class-level [RequiresCapability("audit","View")] made the POST — a write — enforce a read
     * permission, so anyone who could read the trail could also forge entries into it, and (because
     * method attributes ADD to class attributes rather than replacing them) there was no way to give
     * the write its own rule without also demanding the read.
     */
    [Authorize]
    [ApiController]
    [Route("v1")]
    public class AuditController : ControllerBase
    {
        private readonly AuditRepository _auditRepository;

        public AuditController(AuditRepository auditRepository)
        {
            _auditRepository = auditRepository;
        }

        /*
         * POST /v1/audit — the client recording what it just did (viewing a profile, revealing a
         * masked field). Authenticated, but deliberately NOT gated on a capability.
         *
         * There is no coherent "this user lacks permission to be audited": every caller of this
         * endpoint is a user who has just exercised access they already hold, and the whole value of
         * the trail depends on that record being written unconditionally. Gating it would mean a
         * missing grant silently produces gaps in the audit history — the one failure mode an audit
         * system must not have.
         *
         * What actually protects it is that the actor is taken from the verified token and nowhere
         * else (see GetAuthenticatedUser), so a caller can record THAT they acted but never WHO acted.
         */
        [HttpPost("audit")]
        [HttpPost("auditlog")]
        public async Task<IActionResult> CreateAuditLog([FromBody] AuditLogInput input)
        {
            var staffUser = GetAuthenticatedUser();

            var auditLog = new AuditLog
            {
                User = staffUser,
                Action = input.Action ?? "VIEW",
                Description = input.Description ?? string.Empty,
                Status = input.Status ?? "Success",
                CustomerName = input.Customer,
                CustomerType = input.CustomerType,
                CustomerId = input.CustomerId,
                Field = input.Field,
                Timestamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss")
            };

            await _auditRepository.AddAsync(auditLog);

            return Ok(new
            {
                status = 200,
                message = "Audit log recorded successfully."
            });
        }

        // GET /v1/audit — reading the trail IS gated; it exposes every staff member's activity.
        [HttpGet("audit")]
        [HttpGet("auditlog")]
        [RequiresCapability("audit", "View")]
        public async Task<IActionResult> GetAuditLogs(
            [FromQuery] string? search,
            [FromQuery] string? action,
            [FromQuery] int pageNumber = 1,
            [FromQuery] int pageSize = 10)
        {
            /*
             * Clamp server-side. pageSize arrives straight from the query string, so without this a
             * single request for pageSize=1000000 makes the database materialise the whole table into
             * memory - a trivially cheap request that is expensive to serve, which is the shape of an
             * accidental (or deliberate) denial of service. 100 matches the cap AuthService and
             * ModuleRegistry already enforce.
             */
            pageNumber = Math.Max(pageNumber, 1);
            pageSize = Math.Clamp(pageSize, 1, 100);

            var (logs, totalCount) = await _auditRepository.GetAsync(search, action, pageNumber, pageSize);
            int totalPages = (int)Math.Ceiling((double)totalCount / pageSize);
            if (totalPages < 1) totalPages = 1;

            return Ok(new
            {
                status = 200,
                data = logs,
                pageNumber = pageNumber,
                pageSize = pageSize,
                totalCount = totalCount,
                totalPages = totalPages
            });
        }

        /// <summary>
        /// Who to attribute this entry to — read from the VERIFIED token and nowhere else.
        ///
        /// This previously preferred an "X-Staff-User" request header over the JWT, so any caller
        /// could attribute a fabricated entry to any colleague they cared to name. An audit trail
        /// whose actor is client-supplied is worse than no audit trail: it reads as authoritative
        /// while being trivially forgeable, and the fabricated rows are indistinguishable from real
        /// ones after the fact.
        ///
        /// The old "Admin User" catch-all is gone too — it silently mislabelled entries as an
        /// administrator's when no claim resolved. An unattributable entry now says so plainly.
        /// </summary>
        private string GetAuthenticatedUser()
        {
            var nameClaim = User.FindFirst(ClaimTypes.Name)?.Value;
            if (!string.IsNullOrEmpty(nameClaim) && nameClaim != "omniconnect-app")
            {
                return nameClaim;
            }

            var emailClaim = User.FindFirst(ClaimTypes.Email)?.Value;
            if (!string.IsNullOrEmpty(emailClaim))
            {
                return emailClaim;
            }

            // The subject id is the last resort that is still genuinely the caller. Naming it as an
            // id rather than a person keeps the row honest about what is actually known.
            var subClaim = User.FindFirst("sub")?.Value;
            return !string.IsNullOrEmpty(subClaim) ? $"User {subClaim}" : "Unattributed";
        }
    }

    public class AuditLogInput
    {
        public string? Action { get; set; }
        public string? Customer { get; set; }
        public string? CustomerType { get; set; }
        public string? Field { get; set; }
        public string? Status { get; set; }
        public string? Description { get; set; }
        public string? CustomerId { get; set; }
    }
}
