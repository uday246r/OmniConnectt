using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;
using ProductMarketplace.Infrastructure.Data;

namespace ProductMarketplace.Infrastructure.Services;

public class DashboardService : IDashboardService
{
    private readonly AppDbContext _db;
    public DashboardService(AppDbContext db) => _db = db;

    private static double PercentChange(double now, double then)
    {
        if (then == 0) return now == 0 ? 0 : 100;
        return Math.Round((now - then) / then * 100, 1);
    }

    private static KpiDto Kpi(string label, double now, double then, string format) => new()
    {
        Label = label,
        Value = now,
        ChangePercent = PercentChange(now, then),
        Format = format
    };

    public async Task<DashboardSummaryDto> GetSummaryAsync(CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        var cutoff = now.AddDays(-7);

        /*
         * Counted by the database, one query per table.
         *
         * These were ten separate COUNT queries run one after another. Each is cheap, but each is a
         * round trip, and with the database a few hundred milliseconds away the summary took 3–6 s
         * before the page could show a single number. Grouping every row of a table into one group and
         * counting with a filter per figure asks for the same numbers in one statement per table
         * (COUNT(*) FILTER (WHERE …) on Postgres).
         */
        string[] approvedStatuses = ["Approved", "Completed"];

        var productCounts = await _db.Products.AsNoTracking()
            .GroupBy(_ => 1)
            .Select(g => new
            {
                Total = g.Count(),
                TotalThen = g.Count(p => p.CreatedAt <= cutoff),
                Active = g.Count(p => p.Status == "Active"),
                ActiveThen = g.Count(p => p.Status == "Active" && p.CreatedAt <= cutoff),
            })
            .FirstOrDefaultAsync(ct);

        var applicationCounts = await _db.Applications.AsNoTracking()
            .GroupBy(_ => 1)
            .Select(g => new
            {
                Total = g.Count(),
                TotalThen = g.Count(a => a.CreatedAt <= cutoff),
                Approved = g.Count(a => approvedStatuses.Contains(a.Status)),
                ApprovedThen = g.Count(a => approvedStatuses.Contains(a.Status) && a.CreatedAt <= cutoff),
            })
            .FirstOrDefaultAsync(ct);

        var viewCounts = await _db.ProductViewLogs.AsNoTracking()
            .GroupBy(_ => 1)
            .Select(g => new { Total = g.Count(), TotalThen = g.Count(v => v.ViewedAt <= cutoff) })
            .FirstOrDefaultAsync(ct);

        // An empty table has no group to count, so its figures are zero.
        var totalProductsNow = productCounts?.Total ?? 0;
        var totalProductsThen = productCounts?.TotalThen ?? 0;
        var activeNow = productCounts?.Active ?? 0;
        var activeThen = productCounts?.ActiveThen ?? 0;
        var totalAppsNow = applicationCounts?.Total ?? 0;
        var totalAppsThen = applicationCounts?.TotalThen ?? 0;
        var approvedNow = applicationCounts?.Approved ?? 0;
        var approvedThen = applicationCounts?.ApprovedThen ?? 0;

        var conversionNow = totalAppsNow == 0 ? 0 : Math.Round(approvedNow / (double)totalAppsNow * 100, 2);
        var conversionThen = totalAppsThen == 0 ? 0 : Math.Round(approvedThen / (double)totalAppsThen * 100, 2);

        var viewsNow = viewCounts?.Total ?? 0;
        var viewsThen = viewCounts?.TotalThen ?? 0;

        return new DashboardSummaryDto
        {
            TotalProducts = Kpi("Total Products", totalProductsNow, totalProductsThen, "number"),
            ActiveProducts = Kpi("Active Products", activeNow, activeThen, "number"),
            TotalApplications = Kpi("Total Applications", totalAppsNow, totalAppsThen, "number"),
            TotalViews = Kpi("Total Views", viewsNow, viewsThen, "number"),
            ConversionRate = Kpi("Conversion Rate", conversionNow, conversionThen, "percent"),
            RangeStart = cutoff.Date,
            RangeEnd = now.Date
        };
    }

    public async Task<List<TrendPointDto>> GetApplicationTrendAsync(int days, CancellationToken ct = default)
    {
        var start = DateTime.UtcNow.Date.AddDays(-(days - 1));
        // Grouped per day in the database; only one number per day comes back.
        var perDay = await _db.Applications.AsNoTracking()
            .Where(a => a.CreatedAt >= start)
            .GroupBy(a => a.CreatedAt.Date)
            .Select(g => new { Day = g.Key, Count = g.Count() })
            .ToListAsync(ct);
        var counts = perDay.ToDictionary(d => d.Day, d => d.Count);

        var points = new List<TrendPointDto>();
        for (var d = start; d <= DateTime.UtcNow.Date; d = d.AddDays(1))
        {
            points.Add(new TrendPointDto { Label = d.ToString("dd MMM"), Date = d, Value = counts.GetValueOrDefault(d) });
        }
        return points;
    }

    public async Task<List<CategoryBreakdownDto>> GetApplicationsByCategoryAsync(CancellationToken ct = default)
    {
        var data = await _db.Applications.AsNoTracking()
            .Include(a => a.Product).ThenInclude(p => p.Category)
            .GroupBy(a => a.Product.Category.Name)
            .Select(g => new { Category = g.Key, Count = g.Count() })
            .ToListAsync(ct);

        var total = data.Sum(d => d.Count);
        return data.OrderByDescending(d => d.Count)
            .Select(d => new CategoryBreakdownDto { CategoryName = d.Category, Count = d.Count, Percentage = total == 0 ? 0 : Math.Round(d.Count / (double)total * 100, 1) })
            .ToList();
    }

    public async Task<List<StatusDistributionDto>> GetProductStatusDistributionAsync(CancellationToken ct = default)
    {
        var data = await _db.Products.AsNoTracking()
            .GroupBy(p => p.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync(ct);

        var total = data.Sum(d => d.Count);
        return data.OrderByDescending(d => d.Count)
            .Select(d => new StatusDistributionDto { Status = d.Status.ToString(), Count = d.Count, Percentage = total == 0 ? 0 : Math.Round(d.Count / (double)total * 100, 1) })
            .ToList();
    }

    public async Task<List<TopProductDto>> GetTopProductsAsync(int take, CancellationToken ct = default)
    {
        var products = await _db.Products.AsNoTracking()
            .Include(p => p.Category)
            .OrderByDescending(p => p.ApplicationCount)
            .Take(take)
            .Select(p => new TopProductDto { Id = p.Id, Name = p.Name, Code = p.Code, CategoryName = p.Category.Name, IconKey = p.IconKey, ApplicationCount = p.ApplicationCount })
            .ToListAsync(ct);
        return products;
    }

    public async Task<List<RecentProductDto>> GetRecentProductsAsync(int take, CancellationToken ct = default)
    {
        return await _db.Products.AsNoTracking()
            .Include(p => p.Category)
            .OrderByDescending(p => p.CreatedAt)
            .Take(take)
            .Select(p => new RecentProductDto { Id = p.Id, Name = p.Name, CategoryName = p.Category.Name, IconKey = p.IconKey, Status = p.Status.ToString(), CreatedAt = p.CreatedAt })
            .ToListAsync(ct);
    }

    public async Task<List<KeyValuePair<string, int>>> GetTopSearchesAsync(int take, CancellationToken ct = default)
    {
        var logs = await _db.SearchLogs.AsNoTracking().OrderByDescending(s => s.HitCount).Take(take).ToListAsync(ct);
        return logs.Select(l => new KeyValuePair<string, int>(l.Term, l.HitCount)).ToList();
    }
}
