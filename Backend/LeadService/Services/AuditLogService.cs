using Microsoft.EntityFrameworkCore;
using LeadManagement.Api.Data;
using LeadManagement.Api.Models.Dtos;
using LeadManagement.Api.Models.Entities;

namespace LeadManagement.Api.Services
{
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
            string userId = "USR-1001",
            string userName = "Admin User",
            string userRole = "Administrator");

        Task<PagedResultDto<AuditLogDto>> GetAuditLogsAsync(
            int page = 1,
            int pageSize = 10,
            string? search = null,
            string? actionType = null,
            string? entityId = null,
            string? startDate = null,
            string? endDate = null);

        Task<AuditLogDto?> GetAuditLogByIdAsync(string id);
    }

    public class AuditLogService : IAuditLogService
    {
        private readonly ApplicationDbContext _db;

        public AuditLogService(ApplicationDbContext db)
        {
            _db = db;
        }

        public async Task LogAsync(
            string actionType,
            string entityType,
            string entityId,
            string description,
            string? reason = null,
            string? previousValues = null,
            string? newValues = null,
            string userId = "USR-1001",
            string userName = "Admin User",
            string userRole = "Administrator")
        {
            var log = new AuditLog
            {
                Timestamp = DateTime.UtcNow,
                UserId = userId,
                UserName = userName,
                UserRole = userRole,
                ActionType = actionType,
                EntityType = entityType,
                EntityId = entityId,
                Description = description,
                Reason = reason,
                PreviousValues = previousValues,
                NewValues = newValues,
                IpAddress = "127.0.0.1",
                Status = "Success"
            };

            _db.AuditLogs.Add(log);
            await _db.SaveChangesAsync();
        }

        public async Task<PagedResultDto<AuditLogDto>> GetAuditLogsAsync(
            int page = 1,
            int pageSize = 10,
            string? search = null,
            string? actionType = null,
            string? entityId = null,
            string? startDate = null,
            string? endDate = null)
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

            if (!string.IsNullOrWhiteSpace(startDate) && DateTime.TryParse(startDate.Trim(), out var sDate))
            {
                q = q.Where(a => a.Timestamp >= sDate.Date.ToUniversalTime());
            }

            if (!string.IsNullOrWhiteSpace(endDate) && DateTime.TryParse(endDate.Trim(), out var eDate))
            {
                q = q.Where(a => a.Timestamp <= eDate.Date.AddDays(1).AddTicks(-1).ToUniversalTime());
            }

            var totalRecords = await q.CountAsync();

            /*
             * A real cap, at the same 100 AuthService enforces.
             *
             * This previously read "if pageSize is <= 0 or > 1000, set it to totalRecords" — the
             * opposite of a limit: asking for an absurd page size returned the ENTIRE table, so one
             * cheap request could make the database materialise everything into memory. That is the
             * shape of an accidental denial of service.
             *
             * Nothing depended on the old behaviour: CSV export serialises the page already held in
             * component state rather than issuing an unbounded fetch.
             */
            pageSize = Math.Clamp(pageSize, 1, 100);

            page = Math.Max(1, page);
            var totalPages = (int)Math.Ceiling((double)totalRecords / pageSize);
            if (totalPages == 0) totalPages = 1;

            var items = await q.OrderByDescending(a => a.Timestamp)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(a => new AuditLogDto
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
                })
                .ToListAsync();

            return new PagedResultDto<AuditLogDto>
            {
                Items = items,
                TotalRecords = totalRecords,
                Page = page,
                PageSize = pageSize,
                TotalPages = totalPages
            };
        }

        public async Task<AuditLogDto?> GetAuditLogByIdAsync(string id)
        {
            if (!Guid.TryParse(id, out var guid)) return null;

            var a = await _db.AuditLogs.AsNoTracking().FirstOrDefaultAsync(x => x.Id == guid);
            if (a == null) return null;

            return new AuditLogDto
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
}
