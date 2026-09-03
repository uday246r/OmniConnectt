using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using backend.Infrastructure;
using backend.Models;

namespace backend.Data
{
    /// <summary>
    /// Now backed by Customer360DbContext's audit_logs table instead of a local JSON file — the file
    /// version lived on this one process's disk (wiped on every redeploy on ephemeral hosts, and never
    /// shared across replicas). Same read/write shape as before (newest-first, search + action filter,
    /// paginated), so AuditController didn't need to change.
    /// </summary>
    public class AuditRepository
    {
        private readonly Customer360DbContext _db;

        public AuditRepository(Customer360DbContext db)
        {
            _db = db;
        }

        public async Task AddAsync(AuditLog log)
        {
            _db.AuditLogs.Add(log);
            await _db.SaveChangesAsync();
        }

        public async Task<(List<AuditLog> Items, int TotalCount)> GetAsync(
            string? search, string? action, int pageNumber, int pageSize)
        {
            IQueryable<AuditLog> query = _db.AuditLogs.AsNoTracking();

            // 1. Action filter (case-insensitive, ignores "All Actions")
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

            // 2. Search query (case-insensitive matching on user, description, or status)
            if (!string.IsNullOrWhiteSpace(search))
            {
                var pattern = $"%{search}%";
                query = query.Where(l =>
                    EF.Functions.Like(l.User, pattern) ||
                    (l.Description != null && EF.Functions.Like(l.Description, pattern)) ||
                    EF.Functions.Like(l.Status, pattern));
            }

            var totalCount = await query.CountAsync();

            // Newest-first: Timestamp is "yyyy-MM-dd HH:mm:ss" text, which sorts lexicographically
            // identically to chronological order, then Id as a tiebreaker for entries written in the
            // same second.
            var items = await query
                .OrderByDescending(l => l.Timestamp)
                .ThenByDescending(l => l.Id)
                .Skip((pageNumber - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync();

            return (items, totalCount);
        }
    }
}
