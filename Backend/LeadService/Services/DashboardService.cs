using Microsoft.EntityFrameworkCore;
using LeadManagement.Api.Data;
using LeadManagement.Api.Models.Dtos;
using LeadManagement.Api.Models.Entities;
using System.Globalization;

namespace LeadManagement.Api.Services
{
    public interface IDashboardService
    {
        Task<KpiSummaryDto> GetKpiSummaryAsync(DashboardFilterDto filters);
        Task<List<TimeSeriesPointDto>> GetLeadsOverTimeAsync(DashboardFilterDto filters);
        Task<List<ProductDistributionDto>> GetLeadsByProductAsync(DashboardFilterDto filters);
        Task<List<BranchDistributionDto>> GetLeadsByBranchAsync(DashboardFilterDto filters);
        Task<List<LeadRecordDto>> GetRecentLeadsAsync(DashboardFilterDto filters, int limit = 5);
        Task<List<TopSalesExecutiveDto>> GetTopSalesExecutivesAsync(DashboardFilterDto filters, int limit = 5);
    }

    public class DashboardService : IDashboardService
    {
        private readonly ApplicationDbContext _db;
        private readonly IDashboardExternalService _externalService;

        private static readonly string[] ProductColors = new[]
        {
            "#0284c7", // ASB / Blue
            "#16a34a", // Home / Green
            "#eab308", // Auto / Yellow
            "#ea580c", // Personal / Orange
            "#9333ea", // Micro / Purple
            "#2563eb", // Solar / Indigo
            "#0d9488"  // Travel / Teal
        };

        public DashboardService(ApplicationDbContext db, IDashboardExternalService externalService)
        {
            _db = db;
            _externalService = externalService;
        }

        private IQueryable<Lead> ApplyFilters(IQueryable<Lead> query, DashboardFilterDto filters)
        {
            query = query.Where(l => !l.IsDeleted);

            if (filters.StartDate.HasValue)
            {
                var startUtc = DateTime.SpecifyKind(filters.StartDate.Value.Date, DateTimeKind.Utc);
                query = query.Where(l => l.CreatedAt >= startUtc);
            }

            if (filters.EndDate.HasValue)
            {
                var endUtc = DateTime.SpecifyKind(filters.EndDate.Value.Date.AddDays(1).AddTicks(-1), DateTimeKind.Utc);
                query = query.Where(l => l.CreatedAt <= endUtc);
            }

            if (!string.IsNullOrWhiteSpace(filters.Product))
            {
                var p = filters.Product.Trim().ToLower();
                query = query.Where(l => l.ProductName.ToLower() == p);
            }

            if (!string.IsNullOrWhiteSpace(filters.Branch))
            {
                var b = filters.Branch.Trim().ToLower();
                query = query.Where(l => l.Branch != null && l.Branch.Name.ToLower() == b);
            }

            return query;
        }

        public async Task<KpiSummaryDto> GetKpiSummaryAsync(DashboardFilterDto filters)
        {
            IQueryable<Lead> query = _db.Leads.AsNoTracking();
            query = ApplyFilters(query, filters);

            var leadsList = await query
                .Select(l => new { l.CreatedAt, l.Status })
                .ToListAsync();

            var totalLeads = leadsList.Count;

            // Day-wise New Leads Rule: A lead counts as New Lead ONLY on the calendar day it was created.
            var todayUtc = DateTime.UtcNow.Date;
            var newLeads = leadsList.Count(l => l.CreatedAt.Date == todayUtc);

            var convertedLeads = leadsList.Count(l => l.Status.ToLower() == "converted" || l.Status.ToLower() == "qualified");

            // In Progress & Conversion Rate come from External System Service Architecture with local DB fallback
            var inProgressLeads = await _externalService.GetInProgressCountAsync(filters)
                ?? leadsList.Count(l => l.Status.ToLower().Contains("progress"));
            var conversionRate = await _externalService.GetConversionRateAsync(filters)
                ?? (totalLeads > 0 ? Math.Round((double)convertedLeads / totalLeads * 100, 1) : 0);


            // Compute sparkline trends
            var totalTrend = new List<KpiSparklinePointDto>();
            var newTrend = new List<KpiSparklinePointDto>();
            var inProgressTrend = new List<KpiSparklinePointDto>();
            var convertedTrend = new List<KpiSparklinePointDto>();
            var rateTrend = new List<KpiSparklinePointDto>();

            if (leadsList.Any())
            {
                var minDate = filters.StartDate ?? leadsList.Min(l => l.CreatedAt.Date);
                var maxDate = filters.EndDate ?? leadsList.Max(l => l.CreatedAt.Date);

                if ((maxDate - minDate).TotalDays > 30 && !filters.StartDate.HasValue)
                {
                    minDate = maxDate.AddDays(-14);
                }

                for (var dt = minDate.Date; dt <= maxDate.Date; dt = dt.AddDays(1))
                {
                    var dayLeads = leadsList.Where(l => l.CreatedAt.Date == dt).ToList();
                    var dayTotal = dayLeads.Count;
                    var dayNew = dayLeads.Count(l => l.CreatedAt.Date == dt);
                    var dayConverted = dayLeads.Count(l => l.Status.ToLower() == "converted" || l.Status.ToLower() == "qualified");

                    var dateStr = dt.ToString("yyyy-MM-dd");

                    totalTrend.Add(new KpiSparklinePointDto { Date = dateStr, Value = dayTotal });
                    newTrend.Add(new KpiSparklinePointDto { Date = dateStr, Value = dayNew });
                    convertedTrend.Add(new KpiSparklinePointDto { Date = dateStr, Value = dayConverted });
                }
            }

            return new KpiSummaryDto
            {
                TotalLeads = totalLeads,
                NewLeads = newLeads,
                InProgressLeads = inProgressLeads,
                ConvertedLeads = convertedLeads,
                ConversionRate = conversionRate,
                TotalLeadsTrend = totalTrend,
                NewLeadsTrend = newTrend,
                InProgressLeadsTrend = inProgressTrend,
                ConvertedLeadsTrend = convertedTrend,
                ConversionRateTrend = rateTrend
            };
        }

        public async Task<List<TimeSeriesPointDto>> GetLeadsOverTimeAsync(DashboardFilterDto filters)
        {
            IQueryable<Lead> query = _db.Leads.AsNoTracking();
            query = ApplyFilters(query, filters);

            var leads = await query
                .Select(l => l.CreatedAt)
                .ToListAsync();

            if (!leads.Any())
            {
                return new List<TimeSeriesPointDto>();
            }

            var granularity = filters.Granularity?.ToLower() ?? "daily";
            var result = new List<TimeSeriesPointDto>();

            if (granularity == "weekly")
            {
                var grouped = leads
                    .GroupBy(d => CultureInfo.CurrentCulture.Calendar.GetWeekOfYear(d, CalendarWeekRule.FirstDay, DayOfWeek.Monday))
                    .OrderBy(g => g.Key);

                foreach (var group in grouped)
                {
                    var firstDate = group.Min();
                    result.Add(new TimeSeriesPointDto
                    {
                        Label = $"W{group.Key} ({firstDate:dd MMM})",
                        Date = firstDate.ToString("yyyy-MM-dd"),
                        Count = group.Count()
                    });
                }
            }
            else if (granularity == "monthly")
            {
                var grouped = leads
                    .GroupBy(d => new { d.Year, d.Month })
                    .OrderBy(g => g.Key.Year).ThenBy(g => g.Key.Month);

                foreach (var group in grouped)
                {
                    var dt = new DateTime(group.Key.Year, group.Key.Month, 1);
                    result.Add(new TimeSeriesPointDto
                    {
                        Label = dt.ToString("MMM yyyy"),
                        Date = dt.ToString("yyyy-MM"),
                        Count = group.Count()
                    });
                }
            }
            else // daily
            {
                var minDate = filters.StartDate ?? leads.Min().Date;
                var maxDate = filters.EndDate ?? leads.Max().Date;

                if ((maxDate - minDate).TotalDays > 60 && !filters.StartDate.HasValue)
                {
                    minDate = maxDate.AddDays(-30);
                }

                var leadDatesGroup = leads
                    .GroupBy(d => d.Date)
                    .ToDictionary(g => g.Key, g => g.Count());

                for (var dt = minDate.Date; dt <= maxDate.Date; dt = dt.AddDays(1))
                {
                    result.Add(new TimeSeriesPointDto
                    {
                        Label = dt.ToString("dd MMM"),
                        Date = dt.ToString("yyyy-MM-dd"),
                        Count = leadDatesGroup.TryGetValue(dt, out var count) ? count : 0
                    });
                }
            }

            return result;
        }

        public async Task<List<ProductDistributionDto>> GetLeadsByProductAsync(DashboardFilterDto filters)
        {
            IQueryable<Lead> query = _db.Leads.AsNoTracking();
            query = ApplyFilters(query, filters);

            var totalCount = await query.CountAsync();
            if (totalCount == 0) return new List<ProductDistributionDto>();

            var grouped = await query
                .GroupBy(l => l.ProductName)
                .Select(g => new
                {
                    ProductName = g.Key,
                    Count = g.Count()
                })
                .OrderByDescending(x => x.Count)
                .ToListAsync();

            var result = new List<ProductDistributionDto>();
            int colorIdx = 0;

            foreach (var item in grouped)
            {
                double percentage = Math.Round(((double)item.Count / totalCount) * 100, 1);
                result.Add(new ProductDistributionDto
                {
                    ProductName = item.ProductName,
                    Count = item.Count,
                    Percentage = percentage,
                    Color = ProductColors[colorIdx % ProductColors.Length]
                });
                colorIdx++;
            }

            return result;
        }

        public async Task<List<BranchDistributionDto>> GetLeadsByBranchAsync(DashboardFilterDto filters)
        {
            IQueryable<Lead> query = _db.Leads.AsNoTracking().Include(l => l.Branch);
            query = ApplyFilters(query, filters);

            return await query
                .GroupBy(l => l.Branch != null ? l.Branch.Name : "Unassigned")
                .Select(g => new BranchDistributionDto
                {
                    BranchName = g.Key,
                    Count = g.Count()
                })
                .OrderByDescending(b => b.Count)
                .Take(6)
                .ToListAsync();
        }

        public async Task<List<LeadRecordDto>> GetRecentLeadsAsync(DashboardFilterDto filters, int limit = 5)
        {
            IQueryable<Lead> query = _db.Leads
                .AsNoTracking()
                .Include(l => l.State)
                .Include(l => l.Branch)
                .Include(l => l.PreferredSalesExecutive);

            if (!filters.StartDate.HasValue && !filters.EndDate.HasValue)
            {
                var todayUtc = DateTime.UtcNow.Date;
                var nextDayUtc = todayUtc.AddDays(1);
                query = query.Where(l => l.CreatedAt >= todayUtc && l.CreatedAt < nextDayUtc);
            }
            else
            {
                query = ApplyFilters(query, filters);
            }

            return await query
                .OrderByDescending(l => l.CreatedAt)
                .Take(limit)
                .Select(l => new LeadRecordDto
                {
                    Id = l.Id.ToString(),
                    Name = l.CustomerName,
                    IcNumber = l.IcNumber,
                    Phone = $"{l.PhoneCountryCode} {l.PhoneNumber}".Trim(),
                    Email = l.Email,
                    Product = l.ProductName,
                    CatalogProductId = l.CatalogProductId,
                    CategoryName = l.CategoryName,
                    SubCategoryId = l.CatalogSubCategoryId,
                    SubCategoryName = l.SubCategoryName,
                    State = l.State != null ? l.State.Name : string.Empty,
                    Branch = l.Branch != null ? l.Branch.Name : "Not Assigned",
                    Status = l.Status,
                    CreatedDate = l.CreatedAt.ToString("dd MMM yyyy, hh:mm tt"),
                    EmployerName = l.EmployerName,
                    AppliedAmount = l.AppliedAmount.ToString("N2"),
                    PreferredSalesExecutive = l.PreferredSalesExecutive != null ? l.PreferredSalesExecutive.Name : "Unassigned"
                })
                .ToListAsync();
        }

        public async Task<List<TopSalesExecutiveDto>> GetTopSalesExecutivesAsync(DashboardFilterDto filters, int limit = 5)
        {
            var allSalesExecs = await _db.SalesExecutives
                .AsNoTracking()
                .Where(se => se.IsActive)
                .ToListAsync();

            IQueryable<Lead> query = _db.Leads.AsNoTracking().Include(l => l.PreferredSalesExecutive);
            query = ApplyFilters(query, filters);

            var leadGroup = await query
                .Where(l => l.PreferredSalesExecutiveId != null)
                .GroupBy(l => l.PreferredSalesExecutiveId)
                .Select(g => new
                {
                    ExecId = g.Key,
                    Total = g.Count(),
                    Converted = g.Count(x => x.Status.ToLower() == "converted" || x.Status.ToLower() == "qualified")
                })
                .ToListAsync();

            var result = new List<TopSalesExecutiveDto>();

            foreach (var exec in allSalesExecs)
            {
                var stats = leadGroup.FirstOrDefault(g => g.ExecId == exec.Id);
                int total = stats?.Total ?? 0;
                int converted = stats?.Converted ?? 0;
                double convRate = total > 0 ? Math.Round(((double)converted / total) * 100, 2) : 0.0;

                result.Add(new TopSalesExecutiveDto
                {
                    Rank = 0,
                    Name = exec.Name,
                    ConvertedLeads = converted,
                    ConversionRate = convRate
                });
            }

            var ordered = result
                .OrderByDescending(x => x.ConvertedLeads)
                .ThenByDescending(x => x.ConversionRate)
                .ThenBy(x => x.Name)
                .Take(limit)
                .ToList();

            int rank = 1;
            foreach (var item in ordered)
            {
                item.Rank = rank++;
            }

            return ordered;
        }
    }
}
