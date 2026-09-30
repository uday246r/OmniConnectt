namespace ProductMarketplace.Application.Dtos;

/// <summary>
/// One headline figure. It carries a key, not a label: what to call it, in which language, is the
/// screen's decision, and a label built here could not be translated or reworded without a deployment.
/// </summary>
public class KpiDto
{
    public string Key { get; set; } = string.Empty;
    public double Value { get; set; }

    /// <summary>The change against the same figure <see cref="DashboardSummaryDto.ComparedDays"/> days ago.</summary>
    public double ChangePercent { get; set; }
}

public class DashboardSummaryDto
{
    public KpiDto TotalProducts { get; set; } = new();

    /// <summary>Products whose own status is live. Says nothing about whether a category above them hides them.</summary>
    public KpiDto LiveProducts { get; set; } = new();

    /// <summary>Products whose status is not live — drafts and anything an administrator adds that is not.</summary>
    public KpiDto UnpublishedProducts { get; set; } = new();

    public KpiDto TotalCategories { get; set; } = new();
    public KpiDto TotalSubCategories { get; set; } = new();

    public int ComparedDays { get; set; }
    public DateTime RangeStart { get; set; }
    public DateTime RangeEnd { get; set; }
}

/// <summary>A named group and how many products fall in it — a category, or a sub-category when one category is chosen.</summary>
public class CatalogBreakdownDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public int Count { get; set; }
}

public class StatusDistributionDto
{
    public string Status { get; set; } = string.Empty;
    public int Count { get; set; }
    public double Percentage { get; set; }
}

public class RecentProductDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string CategoryName { get; set; } = string.Empty;
    public string SubCategoryName { get; set; } = string.Empty;
    public string IconKey { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}

/// <summary>One line of the dashboard's activity feed — a slim view of an audit entry, for people who may not hold the audit capability.</summary>
public class RecentActivityDto
{
    public Guid Id { get; set; }
    public string Action { get; set; } = string.Empty;
    public string EntityType { get; set; } = string.Empty;
    public string EntityName { get; set; } = string.Empty;
    public string ActorName { get; set; } = string.Empty;
    public DateTime Timestamp { get; set; }
}
