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

        var products = await _db.Products.AsNoTracking().ToListAsync(ct);
        var applications = await _db.Applications.AsNoTracking().ToListAsync(ct);

        var totalProductsNow = products.Count;
        var totalProductsThen = products.Count(p => p.CreatedAt <= cutoff);

        var activeNow = products.Count(p => p.Status == "Active");
        var activeThen = products.Count(p => p.Status == "Active" && p.CreatedAt <= cutoff);

        var totalAppsNow = applications.Count;
        var totalAppsThen = applications.Count(a => a.CreatedAt <= cutoff);

        bool IsApproved(string s) => s is "Approved" or "Completed";
        var approvedNow = applications.Count(a => IsApproved(a.Status));
        var approvedThen = applications.Count(a => IsApproved(a.Status) && a.CreatedAt <= cutoff);

        var conversionNow = totalAppsNow == 0 ? 0 : Math.Round(approvedNow / (double)totalAppsNow * 100, 2);
        var conversionThen = totalAppsThen == 0 ? 0 : Math.Round(approvedThen / (double)totalAppsThen * 100, 2);

        var viewsNow = await _db.ProductViewLogs.AsNoTracking().CountAsync(ct);
        var viewsThen = await _db.ProductViewLogs.AsNoTracking().CountAsync(v => v.ViewedAt <= cutoff, ct);

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
        var applications = await _db.Applications.AsNoTracking().Where(a => a.CreatedAt >= start).ToListAsync(ct);

        var points = new List<TrendPointDto>();
        for (var d = start; d <= DateTime.UtcNow.Date; d = d.AddDays(1))
        {
            var count = applications.Count(a => a.CreatedAt.Date == d);
            points.Add(new TrendPointDto { Label = d.ToString("dd MMM"), Date = d, Value = count });
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
