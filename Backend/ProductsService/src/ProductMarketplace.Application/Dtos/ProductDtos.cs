namespace ProductMarketplace.Application.Dtos;

public class ProductListItemDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string ShortDescription { get; set; } = string.Empty;
    public string IconKey { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;

    public Guid CategoryId { get; set; }
    public string CategoryName { get; set; } = string.Empty;

    public Guid ProductTypeId { get; set; }
    public string ProductTypeName { get; set; } = string.Empty;
    public string ProductTypeCode { get; set; } = string.Empty;
    public string ProductTypeShortLabel { get; set; } = string.Empty;
    public string ApplyButtonLabel { get; set; } = "Apply Now";
    public string AmountFieldLabel { get; set; } = "Requested Amount";

    public double RatingAverage { get; set; }
    public int RatingCount { get; set; }
    public int ApplicationCount { get; set; }

    public List<ProductFieldValueDto> CardFields { get; set; } = new();
    public List<string> FeatureTags { get; set; } = new();
    public PromotionDto? ActivePromotion { get; set; }

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class ProductDetailDto : ProductListItemDto
{
    public string Description { get; set; } = string.Empty;
    public List<ProductFieldValueDto> DetailFields { get; set; } = new();
    public List<ProductBenefitDto> Benefits { get; set; } = new();
    public List<ProductEligibilityDto> EligibilityCriteria { get; set; } = new();
    public List<ReviewDto> RecentReviews { get; set; } = new();
    public List<PromotionDto> Promotions { get; set; } = new();
    public int ViewCount { get; set; }
}

public class ProductBenefitDto
{
    public Guid Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string IconKey { get; set; } = string.Empty;
}

public class ProductBenefitInputDto
{
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string IconKey { get; set; } = "check";
}

public class ProductEligibilityDto
{
    public Guid Id { get; set; }
    public string Criteria { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
}

public class ProductEligibilityInputDto
{
    public string Criteria { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
}

public class ProductCreateUpdateDto
{
    public string Name { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string ShortDescription { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string IconKey { get; set; } = "package";
    public Guid CategoryId { get; set; }
    public Guid ProductTypeId { get; set; }
    public string Status { get; set; } = "Draft";
    public List<ProductFieldValueInputDto> FieldValues { get; set; } = new();
    public List<ProductBenefitInputDto> Benefits { get; set; } = new();
    public List<ProductEligibilityInputDto> EligibilityCriteria { get; set; } = new();
}

public class ProductStatusUpdateDto
{
    public string Status { get; set; } = string.Empty;
}

public class TopPerformerDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string CategoryName { get; set; } = string.Empty;
    public string IconKey { get; set; } = string.Empty;
    public int ApplicationCount { get; set; }
    public int ViewCount { get; set; }
    public double RatingAverage { get; set; }
    public int RatingCount { get; set; }
}

public class ProductQueryDto
{
    public string? Search { get; set; }
    public Guid? CategoryId { get; set; }
    public Guid? ProductTypeId { get; set; }
    public string? Status { get; set; }
    public double? MinRating { get; set; }
    public string Sort { get; set; } = "recommended";
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 8;
}
