namespace LeadManagement.Api.Models.Dtos
{
    public class DashboardFilterDto
    {
        public DateTime? StartDate { get; set; }
        public DateTime? EndDate { get; set; }
        public string? Product { get; set; }
        public string? Branch { get; set; }
        public string Granularity { get; set; } = "daily";
    }

    public class KpiSparklinePointDto
    {
        public string Date { get; set; } = string.Empty;
        public double Value { get; set; }
    }

    public class KpiSummaryDto
    {
        // Nullable so a card the caller was not granted can be withheld without claiming it reads zero.
        // See KpiVisibilityService.
        public int? TotalLeads { get; set; }
        public int? NewLeads { get; set; }
        public int? InProgressLeads { get; set; }
        public int? ConvertedLeads { get; set; }
        public double? ConversionRate { get; set; }

        public List<KpiSparklinePointDto> TotalLeadsTrend { get; set; } = new();
        public List<KpiSparklinePointDto> NewLeadsTrend { get; set; } = new();
        public List<KpiSparklinePointDto> InProgressLeadsTrend { get; set; } = new();
        public List<KpiSparklinePointDto> ConvertedLeadsTrend { get; set; } = new();
        public List<KpiSparklinePointDto> ConversionRateTrend { get; set; } = new();
    }

    public class InProgressKpiDto
    {
        public int? InProgressLeads { get; set; }
        public bool IsAvailable { get; set; }
        public string Source { get; set; } = "External DB System";
    }

    public class ConversionRateKpiDto
    {
        public double? ConversionRate { get; set; }
        public bool IsAvailable { get; set; }
        public string Source { get; set; } = "External DB System";
    }

    public class TimeSeriesPointDto
    {
        public string Label { get; set; } = string.Empty;
        public string Date { get; set; } = string.Empty;
        public int Count { get; set; }
    }

    public class ProductDistributionDto
    {
        public string ProductName { get; set; } = string.Empty;
        public int Count { get; set; }
        public double Percentage { get; set; }
        public string Color { get; set; } = string.Empty;
    }

    public class BranchDistributionDto
    {
        public string BranchName { get; set; } = string.Empty;
        public int Count { get; set; }
    }

    public class TopSalesExecutiveDto
    {
        public int Rank { get; set; }
        public string Name { get; set; } = string.Empty;
        public int? ConvertedLeads { get; set; }
        public double ConversionRate { get; set; }
    }
}
