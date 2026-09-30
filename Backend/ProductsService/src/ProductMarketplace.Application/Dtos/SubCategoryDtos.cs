using System.ComponentModel.DataAnnotations;
using ProductMarketplace.Application.Common;

namespace ProductMarketplace.Application.Dtos;

public class SubCategoryDto
{
    public Guid Id { get; set; }
    public Guid CategoryId { get; set; }
    public string CategoryName { get; set; } = string.Empty;
    public string CategoryCode { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string IconKey { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;

    /// <summary>Whether this sub-category's own status is live. It can be live while hidden, if its category is not.</summary>
    public bool IsLive { get; set; }

    public int DisplayOrder { get; set; }
    public int ProductCount { get; set; }
    public DateTime CreatedAt { get; set; }
}

/// <summary>A sub-category with the attributes its products carry — what the product form renders from.</summary>
public class SubCategoryDetailDto : SubCategoryDto
{
    public List<FieldDefinitionDto> FieldDefinitions { get; set; } = new();
}

public class SubCategoryCreateUpdateDto
{
    [Required(ErrorMessage = "Choose the category this sub-category belongs to.")]
    public Guid CategoryId { get; set; }

    [Required(ErrorMessage = "Sub-category name is required.")]
    [StringLength(150, MinimumLength = 2, ErrorMessage = "Sub-category name must be between 2 and 150 characters.")]
    public string Name { get; set; } = string.Empty;

    [Required(ErrorMessage = "Sub-category code is required.")]
    [StringLength(30, MinimumLength = 2, ErrorMessage = "Sub-category code must be between 2 and 30 characters.")]
    [RegularExpression(CatalogCodes.Pattern, ErrorMessage = CatalogCodes.Message)]
    public string Code { get; set; } = string.Empty;

    [StringLength(1000, ErrorMessage = "Description cannot exceed 1000 characters.")]
    public string Description { get; set; } = string.Empty;

    [StringLength(50, ErrorMessage = "Icon key cannot exceed 50 characters.")]
    public string IconKey { get; set; } = string.Empty;

    /// <summary>Optional; left empty, the configured default status for sub-categories is used.</summary>
    [StringLength(50, ErrorMessage = "Status cannot exceed 50 characters.")]
    public string Status { get; set; } = string.Empty;

    [Range(0, int.MaxValue, ErrorMessage = "Display order cannot be negative.")]
    public int DisplayOrder { get; set; }
}

/// <summary>
/// Filters, sort and page for the sub-category list.
/// </summary>
/// <remarks>
/// <see cref="Sort"/> takes the same values as <see cref="CategoryQueryDto.Sort"/>, ordered within a
/// category by display order by default.
/// </remarks>
public class SubCategoryQueryDto : PagingQuery
{
    public string? Search { get; set; }
    public Guid? CategoryId { get; set; }
    public string? Status { get; set; }
    public string Sort { get; set; } = "order";
}
