using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Application.Common;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;
using ProductMarketplace.Domain.Entities;
using ProductMarketplace.Infrastructure.Data;
using ProductMarketplace.Infrastructure.Realtime;

namespace ProductMarketplace.Infrastructure.Services;

public class AuditLogService : IAuditLogService
{
    private readonly AppDbContext _db;
    private readonly IAuditContext _auditContext;
    private readonly IHubContext<AuditLogHub> _hub;

    public AuditLogService(AppDbContext db, IAuditContext auditContext, IHubContext<AuditLogHub> hub)
    {
        _db = db;
        _auditContext = auditContext;
        _hub = hub;
    }

    public async Task LogAsync(string action, string entityType, Guid? entityId, string entityName, string description,
        bool success = true, string? previousValue = null, string? newValue = null, CancellationToken ct = default)
    {
        var entry = new AuditLog
        {
            Timestamp = DateTime.UtcNow,
            ActorName = _auditContext.ActorName,
            ActorEmail = _auditContext.ActorEmail,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            EntityName = entityName,
            Description = description,
            Success = success,
            PreviousValue = previousValue,
            NewValue = newValue,
            IpAddress = _auditContext.IpAddress
        };

        _db.AuditLogs.Add(entry);
        await _db.SaveChangesAsync(ct);

        await _hub.Clients.All.SendAsync("AuditLogCreated", entry.ToDto(), ct);
    }

    /// <summary>
    /// The single definition of what the caller's filters select. Both the paged list and the summary
    /// aggregates go through it, so the headline numbers can never describe a different set of rows
    /// than the table underneath them.
    /// </summary>
    private IQueryable<AuditLog> ApplyFilters(AuditLogQueryDto query)
    {
        var q = _db.AuditLogs.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(query.Action)) q = q.Where(a => a.Action == query.Action);
        if (!string.IsNullOrWhiteSpace(query.EntityType)) q = q.Where(a => a.EntityType == query.EntityType);
        if (query.From.HasValue) q = q.Where(a => a.Timestamp >= query.From.Value);
        if (query.To.HasValue) q = q.Where(a => a.Timestamp <= query.To.Value);
        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var lower = query.Search.ToLower();
            q = q.Where(a =>
                a.ActorName.ToLower().Contains(lower) ||
                a.EntityName.ToLower().Contains(lower) ||
                a.Description.ToLower().Contains(lower));
        }

        return q;
    }

    public async Task<AuditLogSummaryDto> GetSummaryAsync(AuditLogQueryDto query, CancellationToken ct = default)
    {
        var q = ApplyFilters(query);

        var total = await q.CountAsync(ct);
        var success = await q.CountAsync(a => a.Success, ct);
        var actionTypes = await q.Select(a => a.Action).Distinct().CountAsync(ct);
        var entityTypes = await q.Select(a => a.EntityType).Distinct().CountAsync(ct);

        return new AuditLogSummaryDto
        {
            TotalCount = total,
            SuccessCount = success,
            FailureCount = total - success,
            SuccessRate = total == 0 ? 0 : Math.Round((double)success / total * 100, 1),
            ActionTypeCount = actionTypes,
            EntityTypeCount = entityTypes
        };
    }

    public async Task<List<string>> GetEntityTypesAsync(CancellationToken ct = default) =>
        await _db.AuditLogs.AsNoTracking().Select(a => a.EntityType).Distinct().OrderBy(t => t).ToListAsync(ct);

    public async Task<PagedResult<AuditLogDto>> SearchAsync(AuditLogQueryDto query, CancellationToken ct = default)
    {
        var q = ApplyFilters(query);

        var total = await q.CountAsync(ct);
        var items = await q.OrderByDescending(a => a.Timestamp)
            .Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            .ToListAsync(ct);

        return new PagedResult<AuditLogDto> { Items = items.Select(a => a.ToDto()).ToList(), Page = query.Page, PageSize = query.PageSize, TotalCount = total };
    }

    public async Task<AuditLogDto?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        var entry = await _db.AuditLogs.AsNoTracking().FirstOrDefaultAsync(a => a.Id == id, ct);
        return entry?.ToDto();
    }

    public async Task<List<AuditActionOptionDto>> GetActionOptionsAsync(CancellationToken ct = default)
    {
        var actions = await _db.AuditLogs.AsNoTracking().Select(a => a.Action).Distinct().OrderBy(a => a).ToListAsync(ct);
        return actions.Select(a => new AuditActionOptionDto { Value = a, Label = HumanizeAction(a) }).ToList();
    }

    private static string HumanizeAction(string action)
    {
        var parts = action.Replace('.', ' ').Replace('_', ' ').Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return string.Join(' ', parts.Select(p => char.ToUpperInvariant(p[0]) + p[1..]));
    }
}
