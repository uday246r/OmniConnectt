using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using backend.Data;
using backend.Infrastructure;
using backend.Infrastructure.Audit;
using backend.Infrastructure.Security;
using backend.Models;

namespace backend.Controllers
{
    /// <summary>
    /// Reading this service's audit trail.
    /// </summary>
    /// <remarks>
    /// <para>
    /// There is deliberately no write endpoint here any more. <c>POST /v1/audit</c> used to let the
    /// browser record what it claimed to have just done — the action, the description, the customer
    /// and the outcome all came from the request body. It was justified at the time by "there is no
    /// coherent 'this user lacks permission to be audited'", which is true, and beside the point: the
    /// problem was never authorization, it was that a trail the client writes records only what the
    /// client chooses to admit to. An omitted call left no gap to notice.
    /// </para>
    /// <para>
    /// Entries are now written by the endpoints that actually serve the work, through
    /// <see cref="backend.Infrastructure.Audit.Customer360AuditWriter"/>, so a row exists if and only
    /// if the request really happened.
    /// </para>
    /// </remarks>
    [Authorize]
    [ApiController]
    [Route("v1")]
    public class AuditController : ControllerBase
    {
        private readonly AuditRepository _auditRepository;
        private readonly Customer360AuditWriter _audit;

        public AuditController(AuditRepository auditRepository, Customer360AuditWriter audit)
        {
            _auditRepository = auditRepository;
            _audit = audit;
        }

        // GET /v1/audit — reading the trail IS gated; it exposes every staff member's activity.
        [HttpGet("audit")]
        [HttpGet("auditlog")]
        [RequiresCapability("audit", "View")]
        public async Task<IActionResult> GetAuditLogs(
            [FromQuery] AuditQuery filter,
            // Inclusive instants, named and shaped exactly as AuthService's audit and system-log
            // endpoints name them, so one date-range control in the shared UI drives every log screen
            // on the platform. This service accepted no date filter at all until Timestamp stopped
            // being local-wall-clock text — see Models/AuditLog.Timestamp. They arrive on `filter`,
            // with status, actor, customer and description — see AuditQuery.
            [FromQuery] int pageNumber = 1,
            [FromQuery] int pageSize = 10,
            CancellationToken ct = default)
        {
            /*
             * Clamp server-side. pageSize arrives straight from the query string, so without this a
             * single request for pageSize=1000000 makes the database materialise the whole table into
             * memory - a trivially cheap request that is expensive to serve, which is the shape of an
             * accidental (or deliberate) denial of service. 100 matches the cap AuthService enforces.
             *
             * The export path deliberately does NOT come through here: it has its own, much larger
             * cap and reports when it hits it, rather than quietly serving a hundredth of the answer.
             */
            pageNumber = Math.Max(pageNumber, 1);
            pageSize = Math.Clamp(pageSize, 1, 100);

            var (logs, totalCount) = await _auditRepository.GetAsync(filter, pageNumber, pageSize, ct);
            int totalPages = (int)Math.Ceiling((double)totalCount / pageSize);
            if (totalPages < 1) totalPages = 1;

            return Ok(new
            {
                status = 200,
                data = logs,
                pageNumber,
                pageSize,
                totalCount,
                totalPages
            });
        }

        /// <summary>
        /// The current filtered result set as a CSV file.
        /// </summary>
        /// <remarks>
        /// <para>
        /// New, and it replaces something that never worked as advertised. The CSV was built in the
        /// browser after re-fetching with <c>pageSize=1000</c> — which the list endpoint clamps to
        /// 100 — so "export everything" has always meant "export at most a hundred rows", silently,
        /// with a filename that said otherwise.
        /// </para>
        /// <para>
        /// Gated twice: <c>audit:View</c> because an export is a read of the trail, and
        /// <c>export.csv</c> because taking a copy off the platform is a separate decision from being
        /// able to read it on screen. The manifest used to describe that second capability as "a UI
        /// gate, not a data boundary" — true while the file was assembled client-side from rows the
        /// caller already held, and no longer true now the server assembles it.
        /// </para>
        /// </remarks>
        [HttpGet("audit/export")]
        [RequiresCapability("audit", "View")]
        [RequiresFineCapability("audit", "export.csv")]
        public async Task<IActionResult> ExportAuditLogs(
            [FromQuery] AuditQuery filter,
            CancellationToken ct = default)
        {
            const int maxRows = 10_000;

            var matched = await _auditRepository.CountAsync(filter, ct);
            var rows = await _auditRepository.GetForExportAsync(filter, maxRows, ct);

            var csv = new CsvBuilder(
                "Timestamp", "User", "Action", "Description", "Status",
                "CustomerName", "CustomerType", "CustomerId", "Field");

            foreach (var log in rows)
            {
                csv.AppendRow(
                    // Round-trip format with a real offset. The whole reason this column had to be
                    // migrated off text was that "yyyy-MM-dd HH:mm:ss" says nothing about which zone
                    // it was recorded in; writing that same ambiguity into an export would undo it.
                    log.Timestamp.ToUniversalTime().ToString("O"),
                    log.User, log.Action, log.Description, log.Status,
                    log.CustomerName, log.CustomerType, log.CustomerId, log.Field);
            }

            var export = new CsvExport(csv.ToString(), rows.Count, matched, maxRows);
            ExportHeaders.Apply(Response, export);

            await _audit.WriteAsync(
                action: "EXPORT",
                centralAction: "customer360.audit_log.exported",
                description: $"Exported {export.RowCount} audit row(s)" +
                             (export.Truncated ? $" of {export.MatchCount} matching — the export limit of {export.RowLimit} was reached" : "") +
                             $". Filters: {filter.Describe()}.",
                module: "Audit Logs", page: "audit-logs", actionCategory: "Export", ct: ct);

            return File(export.ToBytes(), "text/csv", $"customer360-audit-logs-{DateTimeOffset.UtcNow:yyyyMMdd-HHmmss}.csv");
        }
    }
}
