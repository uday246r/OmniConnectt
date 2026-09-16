namespace ProductMarketplace.Application.Dtos;

public class KpiDto
{
    public string Label { get; set; } = string.Empty;
    public double Value { get; set; }
    public double ChangePercent { get; set; }
    public string Format { get; set; } = "number";
}

public class DashboardSummaryDto
{
    public KpiDto TotalProducts { get; set; } = new();
    public KpiDto ActiveProducts { get; set; } = new();
    public KpiDto TotalApplications { get; set; } = new();
    public KpiDto TotalViews { get; set; } = new();
    public KpiDto ConversionRate { get; set; } = new();
    public DateTime RangeStart { get; set; }
    public DateTime RangeEnd { get; set; }
}

public class TrendPointDto
{
    public string Label { get; set; } = string.Empty;
    public DateTime Date { get; set; }
    public int Value { get; set; }
}

public class CategoryBreakdownDto
{
    public string CategoryName { get; set; } = string.Empty;
    public int Count { get; set; }
    public double Percentage { get; set; }
}

public class StatusDistributionDto
{
    public string Status { get; set; } = string.Empty;
    public int Count { get; set; }
    public double Percentage { get; set; }
}

public class TopProductDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string CategoryName { get; set; } = string.Empty;
    public string IconKey { get; set; } = string.Empty;
    public int ApplicationCount { get; set; }
}

public class RecentProductDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string CategoryName { get; set; } = string.Empty;
    public string IconKey { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}

