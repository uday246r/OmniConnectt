using System.IdentityModel.Tokens.Jwt;
using Microsoft.EntityFrameworkCore;
using LeadManagement.Api.Data;
using LeadManagement.Api.Models.Dtos;
using LeadManagement.Api.Models.Entities;

namespace LeadManagement.Api.Services
{
    /// <summary>Who an audit row belongs to, when it is not simply the current caller.</summary>
    /// <remarks>
    /// Supplied only on the approval-replay path. There the inbound request comes from AuthService
    /// over the internal API, so the ambient token is a service call rather than a person — and the
    /// person the row belongs to is the MAKER who submitted the change, not whoever approved it.
    /// Every other call site leaves this null and gets the caller from their own token.
    /// </remarks>
    public sealed record AuditActor(string? UserId, string? UserName, string? UserRole = null);

    public interface IAuditLogService
    {
        Task LogAsync(
            string actionType,
            string entityType,
            string entityId,
            string description,
            string? reason = null,
            string? previousValues = null,
            string? newValues = null,
            string status = "Success",
            AuditActor? actor = null,
            CancellationToken ct = default);

        Task<PagedResultDto<AuditLogDto>> GetAuditLogsAsync(
            int page = 1,
            int pageSize = 10,
            string? search = null,
            string? actionType = null,
            string? entityId = null,
            DateTimeOffset? from = null,
            DateTimeOffset? to = null,
            string? actor = null,
            string? status = null,
            CancellationToken ct = default);

        Task<CsvExport> ExportAuditLogsCsvAsync(
            string? search = null,
            string? actionType = null,
            string? entityId = null,
            DateTimeOffset? from = null,
            DateTimeOffset? to = null,
            string? actor = null,
            string? status = null,
            CancellationToken ct = default);

        Task<AuditLogDto?> GetAuditLogByIdAsync(string id);
    }

    /// <summary>
    /// This service's own audit trail — the one the Lead Management screen reads. Central rows go to
    /// AuthService separately, through <c>LeadManagement.Api.Infrastructure.AuthServiceClient</c>.
    /// </summary>
    public class AuditLogService : IAuditLogService
    {
        /// <summary>
        /// The cap on a single export. Matches AuthService's, so an operator exporting the same date
        /// range from the host and from here gets the same answer about what was truncated.
        /// </summary>
        private const int ExportRowLimit = 10_000;

        /// <summary>What a row says when the token carried no usable identity. Deliberately not a
        /// person's name, and deliberately not blank — a reader must be able to tell "we do not know"
        /// apart from "nobody looked".</summary>
        private const string UnattributedUserId = "unattributed";
        private const string UnattributedUserName = "Unattributed";
        private const string UnknownRole = "Unknown";

        private readonly ApplicationDbContext _db;
        private readonly IHttpContextAccessor _httpContextAccessor;
        private readonly AuditActorContext _actorContext;

        public AuditLogService(
            ApplicationDbContext db, IHttpContextAccessor httpContextAccessor, AuditActorContext actorContext)
        {
            _db = db;
            _httpContextAccessor = httpContextAccessor;
            _actorContext = actorContext;
        }

        /// <summary>
        /// Records something this service did.
        /// </summary>
        /// <remarks>
        /// <para>
        /// The actor used to be three optional parameters defaulting to <c>USR-1001</c>,
        /// <c>Admin User</c> and <c>Administrator</c>, and not one of the four call sites passed them.
        /// Every row in this table therefore named a person who does not exist, holding an
        /// administrator's role, acting from <c>127.0.0.1</c> — and the Audit Logs screen rendered
        /// that as fact. A trail that attributes every action to the same fictional administrator is
        /// not a weaker audit trail than none; it is an actively misleading one, because it looks
        /// authoritative and its rows are indistinguishable from real ones.
        /// </para>
        /// <para>
        /// The actor is now resolved here, from the verified token, so no call site can omit it. The
        /// <paramref name="actor"/> override exists for exactly one caller — see <see cref="AuditActor"/>.
        /// </para>
        /// </remarks>
        public async Task LogAsync(
            string actionType,
            string entityType,
            string entityId,
            string description,
            string? reason = null,
            string? previousValues = null,
            string? newValues = null,
            string status = "Success",
            AuditActor? actor = null,
            CancellationToken ct = default)
        {
            // Explicit argument, then the per-request override the replay endpoint sets, then the
            // caller's own token. The middle step is what keeps an approved mutation attributed to
            // its maker rather than to nobody — see AuditActorContext.
            var resolved = actor ?? _actorContext.Override ?? ResolveActorFromToken();

            var log = new AuditLog
            {
                Timestamp = DateTime.UtcNow,
                UserId = resolved.UserId ?? UnattributedUserId,
                UserName = resolved.UserName ?? UnattributedUserName,
                // The token carries a role ID rather than a name (see AuthService's JwtTokenService),
                // so there is no role name to record. "Unknown" is honest; "Administrator", which is
                // what the old default wrote on every single row, was not.
                UserRole = resolved.UserRole ?? UnknownRole,
                ActionType = actionType,
                EntityType = entityType,
                EntityId = entityId,
                Description = description,
                Reason = reason,
                PreviousValues = previousValues,
                NewValues = newValues,
                IpAddress = ResolveSourceIp(),
                Status = status
            };

            _db.AuditLogs.Add(log);
            await _db.SaveChangesAsync(ct);
        }

        private AuditActor ResolveActorFromToken()
        {
            var user = _httpContextAccessor.HttpContext?.User;
            if (user?.Identity?.IsAuthenticated != true)
            {
                return new AuditActor(null, null);
            }

            var sub = user.FindFirst(JwtRegisteredClaimNames.Sub)?.Value ?? user.FindFirst("sub")?.Value;
            var name = user.FindFirst(JwtRegisteredClaimNames.Name)?.Value ?? user.FindFirst("name")?.Value;
            var email = user.FindFirst(JwtRegisteredClaimNames.Email)?.Value ?? user.FindFirst("email")?.Value;

            return new AuditActor(sub, name ?? email ?? (sub is null ? null : $"User {sub}"));
        }

        /// <summary>
        /// The caller's address, not a literal. This column was hardcoded to <c>127.0.0.1</c> on every
        /// row, which made it worse than empty: it looked like a finding.
        /// </summary>
        /// <remarks>
        /// Correct only because LeadService now runs <c>UseForwardedHeaders</c>. Without that,
        /// <c>RemoteIpAddress</c> behind a proxy is the proxy, and every row would record the
        /// infrastructure instead of the person.
        /// </remarks>
        private string ResolveSourceIp() =>
            _httpContextAccessor.HttpContext?.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        public async Task<PagedResultDto<AuditLogDto>> GetAuditLogsAsync(
            int page = 1,
            int pageSize = 10,
            string? search = null,
            string? actionType = null,
            string? entityId = null,
            DateTimeOffset? from = null,
            DateTimeOffset? to = null,
            string? actor = null,
            string? status = null,
            CancellationToken ct = default)
        {
            var q = BuildFilteredQuery(search, actionType, entityId, from, to, actor, status);

            var totalRecords = await q.CountAsync(ct);

            /*
             * A real cap, at the same 100 AuthService enforces.
             *
             * This previously read "if pageSize is <= 0 or > 1000, set it to totalRecords" — the
             * opposite of a limit: asking for an absurd page size returned the ENTIRE table, so one
             * cheap request could make the database materialise everything into memory. That is the
             * shape of an accidental denial of service.
             *
             * The export path deliberately does not come through here. It has its own, much larger
             * cap, and it reports when it hits it rather than silently serving a fraction.
             */
            pageSize = Math.Clamp(pageSize, 1, 100);

            page = Math.Max(1, page);
            var totalPages = (int)Math.Ceiling((double)totalRecords / pageSize);
            if (totalPages == 0) totalPages = 1;

            var items = await q.OrderByDescending(a => a.Timestamp)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(a => ToDto(a))
                .ToListAsync(ct);

            return new PagedResultDto<AuditLogDto>
            {
                Items = items,
                TotalRecords = totalRecords,
                Page = page,
                PageSize = pageSize,
                TotalPages = totalPages
            };
        }

        /// <summary>
        /// The whole filtered result set as CSV, capped, and reporting its cap.
        /// </summary>
        /// <remarks>
        /// Replaces a browser-side export that serialised whichever page of ten rows happened to be
        /// on screen and saved it under a filename claiming to be the audit log. Sharing
        /// <see cref="BuildFilteredQuery"/> with the list is the point: an export that applies a
        /// different filter set from the screen it was launched from is worse than no export at all,
        /// because the file it produces looks authoritative.
        /// </remarks>
        public async Task<CsvExport> ExportAuditLogsCsvAsync(
            string? search = null,
            string? actionType = null,
            string? entityId = null,
            DateTimeOffset? from = null,
            DateTimeOffset? to = null,
            string? actor = null,
            string? status = null,
            CancellationToken ct = default)
        {
            var q = BuildFilteredQuery(search, actionType, entityId, from, to, actor, status);

            var matched = await q.CountAsync(ct);
            var rows = await q.OrderByDescending(a => a.Timestamp).Take(ExportRowLimit).ToListAsync(ct);

            var csv = new CsvBuilder(
                "Timestamp", "UserId", "UserName", "UserRole", "ActionType",
                "EntityType", "EntityId", "Description", "Reason", "Status", "IpAddress");

            foreach (var a in rows)
            {
                csv.AppendRow(
                    // Round-trip format, not the display format the list DTO uses. An export is read
                    // by a spreadsheet or another system, and "yyyy-MM-dd HH:mm:ss" with no offset is
                    // exactly the ambiguity Customer360's timestamp column had to be migrated out of.
                    a.Timestamp.ToUniversalTime().ToString("O"),
                    a.UserId, a.UserName, a.UserRole, a.ActionType,
                    a.EntityType, a.EntityId, a.Description, a.Reason, a.Status, a.IpAddress);
            }

            // PreviousValues/NewValues are deliberately absent. They are JSON snapshots of whole lead
            // records — customer names, IC numbers, amounts — and an export leaves the platform. The
            // diff stays visible in the detail drawer to anyone who already holds AuditLog:View.
            return new CsvExport(csv.ToString(), rows.Count, matched, ExportRowLimit);
        }

        public async Task<AuditLogDto?> GetAuditLogByIdAsync(string id)
        {
            if (!Guid.TryParse(id, out var guid)) return null;

            var a = await _db.AuditLogs.AsNoTracking().FirstOrDefaultAsync(x => x.Id == guid);
            return a == null ? null : ToDto(a);
        }

        private IQueryable<AuditLog> BuildFilteredQuery(
            string? search, string? actionType, string? entityId, DateTimeOffset? from, DateTimeOffset? to,
            string? actor = null, string? status = null)
        {
            var q = _db.AuditLogs.AsNoTracking().AsQueryable();

            if (!string.IsNullOrWhiteSpace(search))
            {
                var s = search.Trim().ToLower();
                q = q.Where(a =>
                    a.UserName.ToLower().Contains(s) ||
                    a.Description.ToLower().Contains(s) ||
                    a.EntityId.ToLower().Contains(s) ||
                    (a.Reason != null && a.Reason.ToLower().Contains(s))
                );
            }

            if (!string.IsNullOrWhiteSpace(actionType))
            {
                var act = actionType.Trim().ToLower();
                q = q.Where(a => a.ActionType.ToLower() == act);
            }

            if (!string.IsNullOrWhiteSpace(entityId))
            {
                var eid = entityId.Trim().ToLower();
                q = q.Where(a => a.EntityId.ToLower() == eid);
            }

            /*
             * Instants, compared against an instant.
             *
             * These were `string?` parsed with DateTime.TryParse, then truncated with `.Date` — which
             * discarded whatever time of day the caller asked for — and then passed through
             * `.ToUniversalTime()` on a Kind=Unspecified value, shifting them by the server's offset a
             * second time. A 09:00 lower bound became 16:00 the previous day at UTC+8. Nothing had
             * noticed because no UI ever exposed a date filter on this screen; the shared date-range
             * control is the first caller these parameters have ever had.
             *
             * Timestamp is a UTC DateTime, so the bound converts once and compares directly.
             * Inclusive on both ends, matching AuthService, so one range means one thing on every log
             * screen in the platform.
             */
            if (from is not null)
            {
                var fromUtc = from.Value.UtcDateTime;
                q = q.Where(a => a.Timestamp >= fromUtc);
            }

            if (to is not null)
            {
                var toUtc = to.Value.UtcDateTime;
                q = q.Where(a => a.Timestamp <= toUtc);
            }

            /*
             * Actor and outcome, applied by the server.
             *
             * The Audit Logs screen filtered these two in the browser over the page it had fetched,
             * while paging stayed server-side — so the two could not both be right. With an actor
             * filter on, the pager either described rows that were not on screen or, as the page
             * eventually chose, gave up on reaching matches on other pages. The export ignored both.
             *
             * Actor matches name or role, as the Performed By column shows them. Status keeps the
             * screen's two-way reading: anything not recorded as a failure counts as a success.
             */
            if (!string.IsNullOrWhiteSpace(actor))
            {
                var who = actor.Trim().ToLower();
                q = q.Where(a => a.UserName.ToLower().Contains(who) || a.UserRole.ToLower().Contains(who));
            }

            if (!string.IsNullOrWhiteSpace(status))
            {
                var wantFailed = string.Equals(status.Trim(), "FAILED", StringComparison.OrdinalIgnoreCase)
                              || string.Equals(status.Trim(), "Failure", StringComparison.OrdinalIgnoreCase);
                q = wantFailed
                    ? q.Where(a => a.Status.ToUpper() == "FAILED" || a.Status.ToUpper() == "FAILURE")
                    : q.Where(a => a.Status.ToUpper() != "FAILED" && a.Status.ToUpper() != "FAILURE");
            }

            return q;
        }

        private static AuditLogDto ToDto(AuditLog a) => new()
        {
            Id = a.Id.ToString(),
            Timestamp = a.Timestamp.ToString("yyyy-MM-dd HH:mm:ss"),
            UserId = a.UserId,
            UserName = a.UserName,
            UserRole = a.UserRole,
            ActionType = a.ActionType,
            EntityType = a.EntityType,
            EntityId = a.EntityId,
            Description = a.Description,
            Reason = a.Reason,
            PreviousValues = a.PreviousValues,
            NewValues = a.NewValues,
            IpAddress = a.IpAddress,
            Status = a.Status
        };
    }
}
