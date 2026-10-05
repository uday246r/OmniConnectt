using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Application.Common;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;
using ProductMarketplace.Infrastructure.Data;

namespace ProductMarketplace.Infrastructure.Services;

public class DashboardService : IDashboardService
{
    private readonly AppDbContext _db;
    private readonly ICatalogStatuses _statuses;

    public DashboardService(AppDbContext db, ICatalogStatuses statuses)
    {
        _db = db;
        _statuses = statuses;
    }

    private static double PercentChange(double now, double then)
    {
        if (then == 0) return now == 0 ? 0 : 100;
        return Math.Round((now - then) / then * 100, 1);
    }

    private static KpiDto Kpi(string key, double now, double then) => new() { Key = key, Value = now, ChangePercent = PercentChange(now, then) };

    /// <remarks>
    /// One grouped query per table — <c>COUNT(*) FILTER (WHERE …)</c> on Postgres — rather than one round
    /// trip per figure, which took seconds when the database is a few hundred milliseconds away. There is
    /// no status history, so "then" counts what exists now that was already created by the cutoff.
    /// </remarks>
    public async Task<DashboardSummaryDto> GetSummaryAsync(int comparedDays, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        var cutoff = now.AddDays(-comparedDays);
        var live = (await _statuses.LiveValuesAsync(StatusEntityTypes.Product, ct)).ToArray();

        var products = await _db.Products.AsNoTracking()
            .GroupBy(_ => 1)
            .Select(g => new
            {
                Total = g.Count(),
                TotalThen = g.Count(p => p.CreatedAt <= cutoff),
                Live = g.Count(p => live.Contains(p.Status)),
                LiveThen = g.Count(p => live.Contains(p.Status) && p.CreatedAt <= cutoff),
            })
            .FirstOrDefaultAsync(ct);

        var categories = await _db.Categories.AsNoTracking()
            .GroupBy(_ => 1)
            .Select(g => new { Total = g.Count(), TotalThen = g.Count(c => c.CreatedAt <= cutoff) })
            .FirstOrDefaultAsync(ct);

        var subCategories = await _db.SubCategories.AsNoTracking()
            .GroupBy(_ => 1)
            .Select(g => new { Total = g.Count(), TotalThen = g.Count(s => s.CreatedAt <= cutoff) })
            .FirstOrDefaultAsync(ct);

        // An empty table has no group to count, so its figures are zero.
        var total = products?.Total ?? 0;
        var totalThen = products?.TotalThen ?? 0;
        var liveNow = products?.Live ?? 0;
        var liveThen = products?.LiveThen ?? 0;

        return new DashboardSummaryDto
        {
            TotalProducts = Kpi("totalProducts", total, totalThen),
            LiveProducts = Kpi("liveProducts", liveNow, liveThen),
            UnpublishedProducts = Kpi("unpublishedProducts", total - liveNow, totalThen - liveThen),
            TotalCategories = Kpi("totalCategories", categories?.Total ?? 0, categories?.TotalThen ?? 0),
            TotalSubCategories = Kpi("totalSubCategories", subCategories?.Total ?? 0, subCategories?.TotalThen ?? 0),
            ComparedDays = comparedDays,
            RangeStart = cutoff.Date,
            RangeEnd = now.Date
        };
    }

    public async Task<List<CatalogBreakdownDto>> GetProductBreakdownAsync(Guid? categoryId, CancellationToken ct = default)
    {
        if (categoryId.HasValue)
        {
            return await _db.SubCategories.AsNoTracking()
                .Where(s => s.CategoryId == categoryId)
                .OrderBy(s => s.DisplayOrder)
                .Select(s => new CatalogBreakdownDto { Id = s.Id, Name = s.Name, Code = s.Code, Count = s.Products.Count })
                .ToListAsync(ct);
        }

        return await _db.Categories.AsNoTracking()
            .OrderBy(c => c.DisplayOrder)
            .Select(c => new CatalogBreakdownDto { Id = c.Id, Name = c.Name, Code = c.Code, Count = c.SubCategories.SelectMany(s => s.Products).Count() })
            .ToListAsync(ct);
    }

    public async Task<List<StatusDistributionDto>> GetProductStatusDistributionAsync(CancellationToken ct = default)
    {
        var data = await _db.Products.AsNoTracking()
            .GroupBy(p => p.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync(ct);

        var total = data.Sum(d => d.Count);
        return data.OrderByDescending(d => d.Count)
            .Select(d => new StatusDistributionDto { Status = d.Status, Count = d.Count, Percentage = total == 0 ? 0 : Math.Round(d.Count / (double)total * 100, 1) })
            .ToList();
    }

    public async Task<List<RecentProductDto>> GetRecentProductsAsync(int take, CancellationToken ct = default) =>
        await _db.Products.AsNoTracking()
            .OrderByDescending(p => p.CreatedAt).ThenBy(p => p.Id)
            .Take(take)
            .Select(p => new RecentProductDto
            {
                Id = p.Id,
                Name = p.Name,
                Code = p.Code,
                CategoryName = p.SubCategory.Category.Name,
                SubCategoryName = p.SubCategory.Name,
                IconKey = p.IconKey,
                Status = p.Status,
                CreatedAt = p.CreatedAt
            })
            .ToListAsync(ct);

    /// <summary>Changes people made — not the searches and product views, which are traffic, not activity.</summary>
    public async Task<List<RecentActivityDto>> GetRecentActivityAsync(int take, CancellationToken ct = default) =>
        await _db.AuditLogs.AsNoTracking()
            .Where(a => a.Action != AuditActions.Search && a.Action != AuditActions.ViewProduct)
            .OrderByDescending(a => a.Timestamp)
            .Take(take)
            .Select(a => new RecentActivityDto
            {
                Id = a.Id,
                Action = a.Action,
                EntityType = a.EntityType,
                EntityName = a.EntityName,
                ActorName = a.ActorName,
                Timestamp = a.Timestamp
            })
            .ToListAsync(ct);

    public async Task<List<KeyValuePair<string, int>>> GetTopSearchesAsync(int take, CancellationToken ct = default)
    {
        var logs = await _db.SearchLogs.AsNoTracking().OrderByDescending(s => s.HitCount).Take(take).ToListAsync(ct);
        return logs.Select(l => new KeyValuePair<string, int>(l.Term, l.HitCount)).ToList();
    }
}
