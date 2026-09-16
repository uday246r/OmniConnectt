namespace ProductMarketplace.Application.Dtos;

public class PromotionDto
{
    public Guid Id { get; set; }
    public Guid ProductId { get; set; }
    public string ProductName { get; set; } = string.Empty;
    public string ProductCategoryName { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string BadgeText { get; set; } = string.Empty;
    public string OfferDetail { get; set; } = string.Empty;
    public string TermsAndConditions { get; set; } = string.Empty;
    public DateTime StartDate { get; set; }
    public DateTime EndDate { get; set; }
    public int Priority { get; set; }
    public string Status { get; set; } = string.Empty;
}

public class PromotionCreateUpdateDto
{
    public Guid ProductId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string BadgeText { get; set; } = string.Empty;
    public string OfferDetail { get; set; } = string.Empty;
    public string TermsAndConditions { get; set; } = string.Empty;
    public DateTime StartDate { get; set; }
    public DateTime EndDate { get; set; }
    public int Priority { get; set; }
    public string Status { get; set; } = "Draft";
}

public class PromotionStatusUpdateDto
{
    public string Status { get; set; } = string.Empty;
}

public class PromotionQueryDto
{
    public string? Search { get; set; }
    public Guid? ProductId { get; set; }
    public string? Status { get; set; }
    private int _page = 1;
    private int _pageSize = 10;

    /// <summary>1 or greater; anything lower is read as the first page rather than failing with a negative offset.</summary>
    public int Page { get => _page; set => _page = value < 1 ? 1 : value; }

    /// <summary>Between 1 and <see cref="Common.Paging.MaxPageSize"/>, so no caller can ask for the whole table in one response.</summary>
    public int PageSize { get => _pageSize; set => _pageSize = Common.Paging.Clamp(value, 10); }
}
