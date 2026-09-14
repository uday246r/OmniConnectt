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
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 10;
}
