using System.ComponentModel.DataAnnotations;
using ProductMarketplace.Application.Common;

namespace ProductMarketplace.Application.Dtos;

public class ProductListItemDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string ShortDescription { get; set; } = string.Empty;
    public string IconKey { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;

    /// <summary>
    /// Whether the catalogue shows this product: its own status, its sub-category's and its category's are
    /// all live. A product can hold a live status and still be hidden because a category above it is not.
    /// </summary>
    public bool IsVisible { get; set; }

    public Guid CategoryId { get; set; }
    public string CategoryName { get; set; } = string.Empty;
    public Guid SubCategoryId { get; set; }
    public string SubCategoryName { get; set; } = string.Empty;
    public string SubCategoryCode { get; set; } = string.Empty;

    public List<ProductFieldValueDto> CardFields { get; set; } = new();

    /// <summary>The product's benefit titles, in order. How many fit on a card is the card's decision.</summary>
    public List<string> FeatureTags { get; set; } = new();

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class ProductDetailDto : ProductListItemDto
{
    public string Description { get; set; } = string.Empty;
    public List<ProductFieldValueDto> DetailFields { get; set; } = new();
    public List<ProductBenefitDto> Benefits { get; set; } = new();
    public List<ProductEligibilityDto> EligibilityCriteria { get; set; } = new();
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
    public string IconKey { get; set; } = string.Empty;
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
    [Required(ErrorMessage = "Choose the sub-category this product belongs to.")]
    public Guid SubCategoryId { get; set; }

    [Required(ErrorMessage = "Product name is required.")]
    [StringLength(200, MinimumLength = 2, ErrorMessage = "Product name must be between 2 and 200 characters.")]
    public string Name { get; set; } = string.Empty;

    [Required(ErrorMessage = "Product code is required.")]
    [StringLength(50, MinimumLength = 2, ErrorMessage = "Product code must be between 2 and 50 characters.")]
    [RegularExpression(CatalogCodes.Pattern, ErrorMessage = CatalogCodes.Message)]
    public string Code { get; set; } = string.Empty;

    [StringLength(500, ErrorMessage = "Short description cannot exceed 500 characters.")]
    public string ShortDescription { get; set; } = string.Empty;

    [StringLength(4000, ErrorMessage = "Description cannot exceed 4000 characters.")]
    public string Description { get; set; } = string.Empty;

    [StringLength(50, ErrorMessage = "Icon key cannot exceed 50 characters.")]
    public string IconKey { get; set; } = string.Empty;

    /// <summary>Optional; left empty, the configured default status for products is used.</summary>
    [StringLength(50, ErrorMessage = "Status cannot exceed 50 characters.")]
    public string Status { get; set; } = string.Empty;

    public List<ProductFieldValueInputDto> FieldValues { get; set; } = new();
    public List<ProductBenefitInputDto> Benefits { get; set; } = new();
    public List<ProductEligibilityInputDto> EligibilityCriteria { get; set; } = new();
}

public class ProductStatusUpdateDto
{
    [Required(ErrorMessage = "A status is required.")]
    public string Status { get; set; } = string.Empty;
}

/// <summary>
/// Filters, sort and page for the product catalogue.
/// </summary>
/// <remarks>
/// <para>
/// <see cref="Sort"/> is one of <c>newest</c> (the default), <c>oldest</c>, <c>name</c>, <c>-name</c>,
/// <c>primary-metric</c> (lowest first) or <c>-primary-metric</c>; anything else reads as the default.
/// </para>
/// <para>
/// <see cref="VisibleOnly"/> is what separates the two audiences. The admin catalogue leaves it unset and
/// sees every product, including ones hidden by an inactive category, so they can be managed. Anything
/// that offers products to a customer or to another service (the lead form) sets it, and receives only
/// products the catalogue currently shows.
/// </para>
/// </remarks>
public class ProductQueryDto : PagingQuery
{
    protected override int DefaultPageSize => 12;

    public string? Search { get; set; }
    public Guid? CategoryId { get; set; }
    public Guid? SubCategoryId { get; set; }
    public string? Status { get; set; }
    public bool VisibleOnly { get; set; }
    public string Sort { get; set; } = "newest";
}
