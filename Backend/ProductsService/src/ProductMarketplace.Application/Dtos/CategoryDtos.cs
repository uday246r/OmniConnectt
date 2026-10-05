using System.ComponentModel.DataAnnotations;
using ProductMarketplace.Application.Common;

namespace ProductMarketplace.Application.Dtos;

public class CategoryDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string IconKey { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;

    /// <summary>Whether the category's status is one Setup marks live. When false, everything beneath it is hidden from the catalogue.</summary>
    public bool IsLive { get; set; }

    public int DisplayOrder { get; set; }
    public int SubCategoryCount { get; set; }

    /// <summary>Products beneath this category's sub-categories, whatever their status.</summary>
    public int ProductCount { get; set; }

    public DateTime CreatedAt { get; set; }
}

public class CategoryCreateUpdateDto
{
    [Required(ErrorMessage = "Category name is required.")]
    [StringLength(150, MinimumLength = 2, ErrorMessage = "Category name must be between 2 and 150 characters.")]
    public string Name { get; set; } = string.Empty;

    [Required(ErrorMessage = "Category code is required.")]
    [StringLength(30, MinimumLength = 2, ErrorMessage = "Category code must be between 2 and 30 characters.")]
    [RegularExpression(CatalogCodes.Pattern, ErrorMessage = CatalogCodes.Message)]
    public string Code { get; set; } = string.Empty;

    [StringLength(1000, ErrorMessage = "Description cannot exceed 1000 characters.")]
    public string Description { get; set; } = string.Empty;

    [StringLength(50, ErrorMessage = "Icon key cannot exceed 50 characters.")]
    public string IconKey { get; set; } = string.Empty;

    /// <summary>
    /// Optional. Left empty, the API resolves the configured default status for categories from
    /// StatusConfig rather than assuming a literal value that Setup may have renamed or disabled.
    /// </summary>
    [StringLength(50, ErrorMessage = "Status cannot exceed 50 characters.")]
    public string Status { get; set; } = string.Empty;

    [Range(0, int.MaxValue, ErrorMessage = "Display order cannot be negative.")]
    public int DisplayOrder { get; set; }
}

public class CategoryReorderDto
{
    [Required]
    [RegularExpression("^(?i:up|down)$", ErrorMessage = "Direction must be either 'up' or 'down'.")]
    public string Direction { get; set; } = "up";
}

/// <summary>
/// Filters, sort and page for the category list.
/// </summary>
/// <remarks>
/// <see cref="Sort"/> is one of <c>order</c> (the configured display order, the default), <c>name</c>,
/// <c>-name</c>, <c>created</c>, <c>-created</c>, <c>products</c>, <c>-products</c>. Anything else is read
/// as the default rather than failing.
/// </remarks>
public class CategoryQueryDto : PagingQuery
{
    public string? Search { get; set; }
    public string? Status { get; set; }
    public string Sort { get; set; } = "order";
}

/// <summary>The shape every catalogue code (category, sub-category, product) must have, in one place.</summary>
public static class CatalogCodes
{
    public const string Pattern = "^[A-Za-z0-9][A-Za-z0-9_-]*$";
    public const string Message = "A code may contain only letters, numbers, hyphens and underscores, and must start with a letter or number.";

    /// <summary>Codes are stored and compared upper-case, so "cc" and "CC" cannot both exist.</summary>
    public static string Normalise(string code) => code.Trim().ToUpperInvariant();
}
