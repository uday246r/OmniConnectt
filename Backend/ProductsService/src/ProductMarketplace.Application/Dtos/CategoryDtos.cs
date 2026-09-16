using System.ComponentModel.DataAnnotations;

namespace ProductMarketplace.Application.Dtos;

public class CategoryDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string IconKey { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public int DisplayOrder { get; set; }
    /// <summary>Products filed directly against this category.</summary>
    public int ProductCount { get; set; }
    /// <summary>Products against this category or any of its descendants - what "linked products" means to an admin.</summary>
    public int TotalProductCount { get; set; }
    public int SubCategoryCount { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class CategoryCreateUpdateDto
{
    [Required(ErrorMessage = "Category name is required.")]
    [StringLength(150, MinimumLength = 2, ErrorMessage = "Category name must be between 2 and 150 characters.")]
    public string Name { get; set; } = string.Empty;

    [StringLength(1000, ErrorMessage = "Description cannot exceed 1000 characters.")]
    public string Description { get; set; } = string.Empty;

    [StringLength(50, ErrorMessage = "Icon key cannot exceed 50 characters.")]
    public string IconKey { get; set; } = "package";

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
