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
    private readonly IAuditForwarder _forwarder;

    public AuditLogService(AppDbContext db, IAuditContext auditContext, IHubContext<AuditLogHub> hub, IAuditForwarder forwarder)
    {
        _db = db;
        _auditContext = auditContext;
        _hub = hub;
        _forwarder = forwarder;
    }

    public async Task LogAsync(string action, string entityType, Guid? entityId, string entityName, string description,
        bool success = true, string? previousValue = null, string? newValue = null, CancellationToken ct = default)
    {
        var entry = new AuditLog
        {
            Timestamp = DateTime.UtcNow,
            ActorUserId = _auditContext.UserId,
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

        /*
         * Only to signed-in audit viewers. This broadcast to Clients.All over an anonymous hub, so anyone
         * who opened a socket received every action taken in the marketplace — customer names and
         * application numbers included — the moment it happened.
         */
        await _hub.Clients.Group(AuditLogHub.ViewersGroup).SendAsync("AuditLogCreated", entry.ToDto(), ct);

        await _forwarder.ForwardAsync(new AuditForwardEntry(
            action, entityType, entityId, entityName, description, success, entry.ActorUserId, entry.ActorName), ct);
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
        if (query.From.HasValue) { var from = query.From.Value.UtcDateTime; q = q.Where(a => a.Timestamp >= from); }
        if (query.To.HasValue) { var to = query.To.Value.UtcDateTime; q = q.Where(a => a.Timestamp <= to); }
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

        // Two statements instead of four sequential ones (each is a round trip to the database): the
        // plain counts share one grouped query, the two distinct counts share another.
        var counts = await q
            .GroupBy(_ => 1)
            .Select(g => new
            {
                Total = g.Count(),
                Success = g.Count(a => a.Success),
            })
            .FirstOrDefaultAsync(ct);
        var distinct = await q
            .GroupBy(_ => 1)
            .Select(g => new
            {
                ActionTypes = g.Select(a => a.Action).Distinct().Count(),
                EntityTypes = g.Select(a => a.EntityType).Distinct().Count(),
            })
            .FirstOrDefaultAsync(ct);

        var total = counts?.Total ?? 0;
        var success = counts?.Success ?? 0;
        var actionTypes = distinct?.ActionTypes ?? 0;
        var entityTypes = distinct?.EntityTypes ?? 0;

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

    /// <summary>The largest audit export served in one file.</summary>
    public const int ExportRowLimit = 10_000;

    /// <summary>
    /// Replaces a CSV the browser assembled from the one page of rows on screen and saved under a name
    /// that claimed to be the audit log. Uses <see cref="ApplyFilters"/>, the same definition the list
    /// uses, so the file always answers the question the screen was answering.
    /// </summary>
    public async Task<CsvExport> ExportCsvAsync(AuditLogQueryDto query, CancellationToken ct = default)
    {
        var q = ApplyFilters(query);
        var matched = await q.CountAsync(ct);
        var rows = await q.OrderByDescending(a => a.Timestamp).Take(ExportRowLimit).ToListAsync(ct);

        var csv = new CsvBuilder("Time (UTC)", "Performed by", "Email", "What happened", "Record type", "Record", "Description", "Outcome", "Before", "After");
        foreach (var a in rows)
        {
            csv.AppendRow(
                a.Timestamp.ToString("O"), a.ActorName, a.ActorEmail, HumanizeAction(a.Action), a.EntityType, a.EntityName,
                a.Description, a.Success ? "Success" : "Failure", a.PreviousValue, a.NewValue);
        }

        return new CsvExport(csv.ToString(), rows.Count, matched, ExportRowLimit);
    }

    private static string HumanizeAction(string action)
    {
        var parts = action.Replace('.', ' ').Replace('_', ' ').Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return string.Join(' ', parts.Select(p => char.ToUpperInvariant(p[0]) + p[1..]));
    }
}
