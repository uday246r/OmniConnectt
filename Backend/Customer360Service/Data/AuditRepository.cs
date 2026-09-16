using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using backend.Infrastructure;
using backend.Models;

namespace backend.Data
{
    /// <summary>
    /// Backed by Customer360DbContext's audit_logs table — a redeploy no longer wipes the trail and
    /// replicas no longer keep diverging copies, as they did when this was a local JSON file.
    /// </summary>
    /// <remarks>
    /// Writes arrive from <see cref="backend.Infrastructure.Audit.Customer360AuditWriter"/> only.
    /// They used to arrive from the BROWSER, over a <c>POST /v1/audit</c> that any authenticated
    /// caller could invoke with a body of their choosing; the endpoint is gone and the service now
    /// records its own actions.
    /// </remarks>
    public class AuditRepository
    {
        private readonly Customer360DbContext _db;

        public AuditRepository(Customer360DbContext db)
        {
            _db = db;
        }

        public async Task AddAsync(AuditLog log, CancellationToken ct = default)
        {
            _db.AuditLogs.Add(log);
            await _db.SaveChangesAsync(ct);
        }

        public async Task<(List<AuditLog> Items, int TotalCount)> GetAsync(
            AuditQuery filter, int pageNumber, int pageSize, CancellationToken ct = default)
        {
            var query = BuildFilteredQuery(filter);

            var totalCount = await query.CountAsync(ct);

            var items = await OrderNewestFirst(query)
                .Skip((pageNumber - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync(ct);

            return (items, totalCount);
        }

        /// <summary>
        /// The same filtered set an export needs, capped by the caller rather than paged. Shares
        /// <see cref="BuildFilteredQuery"/> with <see cref="GetAsync"/> deliberately: an export that
        /// applies a different filter set from the screen it was launched from is worse than no
        /// export, because it looks authoritative.
        /// </summary>
        public Task<List<AuditLog>> GetForExportAsync(AuditQuery filter, int maxRows, CancellationToken ct = default) =>
            OrderNewestFirst(BuildFilteredQuery(filter)).Take(maxRows).ToListAsync(ct);

        public Task<int> CountAsync(AuditQuery filter, CancellationToken ct = default) =>
            BuildFilteredQuery(filter).CountAsync(ct);

        // Id is the tiebreaker for rows written within the same instant. It is a random GUID string,
        // so it orders arbitrarily — but deterministically, which is what paging needs to avoid a row
        // appearing on two consecutive pages.
        private static IQueryable<AuditLog> OrderNewestFirst(IQueryable<AuditLog> query) =>
            query.OrderByDescending(l => l.Timestamp).ThenByDescending(l => l.Id);

        private IQueryable<AuditLog> BuildFilteredQuery(AuditQuery filter)
        {
            IQueryable<AuditLog> query = _db.AuditLogs.AsNoTracking();
            var (search, action, from, to) = (filter.Search, filter.Action, filter.From, filter.To);

            // Action filter (case-insensitive, ignores "All Actions")
            if (!string.IsNullOrWhiteSpace(action) && !action.Equals("All Actions", StringComparison.OrdinalIgnoreCase))
            {
                if (action.Equals("VIEW", StringComparison.OrdinalIgnoreCase))
                {
                    query = query.Where(l => EF.Functions.Like(l.Action, "VIEW%"));
                }
                else
                {
                    query = query.Where(l => l.Action.ToLower() == action.ToLower());
                }
            }

            // Search query (case-insensitive matching on user, description, or status)
            if (!string.IsNullOrWhiteSpace(search))
            {
                var pattern = $"%{search}%";
                query = query.Where(l =>
                    EF.Functions.Like(l.User, pattern) ||
                    (l.Description != null && EF.Functions.Like(l.Description, pattern)) ||
                    EF.Functions.Like(l.Status, pattern));
            }

            // Inclusive on both ends, matching AuthService's audit and system-log queries exactly, so
            // the same range typed into any of the platform's log screens selects the same rows.
            if (from is not null)
            {
                query = query.Where(l => l.Timestamp >= from);
            }

            if (to is not null)
            {
                query = query.Where(l => l.Timestamp <= to);
            }

            /*
             * The four filters the screen used to apply in the browser. Lower-cased on both sides:
             * they were case-insensitive client-side, and a search that stopped matching "Asha" for
             * "asha" once it moved to the server would read as missing data.
             */
            if (!string.IsNullOrWhiteSpace(filter.Status))
            {
                var wantSuccess = filter.Status.Trim().Equals("SUCCESS", StringComparison.OrdinalIgnoreCase);
                query = wantSuccess
                    ? query.Where(l => l.Status == "" || l.Status.ToUpper() == "SUCCESS")
                    : query.Where(l => l.Status != "" && l.Status.ToUpper() != "SUCCESS");
            }

            if (!string.IsNullOrWhiteSpace(filter.Actor))
            {
                var who = filter.Actor.Trim().ToLower();
                var asId = Guid.TryParse(filter.Actor.Trim(), out var id) ? id : (Guid?)null;
                query = query.Where(l => l.User.ToLower().Contains(who) || (asId != null && l.UserId == asId));
            }

            if (!string.IsNullOrWhiteSpace(filter.Customer))
            {
                var customer = filter.Customer.Trim().ToLower();
                query = query.Where(l =>
                    (l.CustomerName != null && l.CustomerName.ToLower().Contains(customer)) ||
                    (l.CustomerId != null && l.CustomerId.ToLower().Contains(customer)));
            }

            if (!string.IsNullOrWhiteSpace(filter.Description))
            {
                var text = filter.Description.Trim().ToLower();
                query = query.Where(l => l.Description.ToLower().Contains(text));
            }

            return query;
        }
    }
}
