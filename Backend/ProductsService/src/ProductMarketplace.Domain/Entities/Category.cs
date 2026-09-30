namespace ProductMarketplace.Domain.Entities;

/// <summary>
/// A line of business: Loans, Credit Cards, Deposits. The top of the catalogue's three levels
/// (Category → SubCategory → Product) and the level navigation and reporting group by.
/// </summary>
/// <remarks>
/// A category holds no products directly. Every product belongs to a <see cref="SubCategory"/>, and its
/// category is whichever one that sub-category sits under — so a product can never contradict its own
/// taxonomy. Marking a category inactive hides everything beneath it without touching those records'
/// own statuses; see <c>CatalogVisibility</c>.
/// </remarks>
public class Category
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;

    /// <summary>Short, stable, upper-case identifier shown next to the name (CC, LN). Unique.</summary>
    public string Code { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;
    public string IconKey { get; set; } = string.Empty;

    /// <summary>A value from <see cref="StatusConfig"/> for the Category entity type — a string, not an enum, so Setup can add more.</summary>
    public string Status { get; set; } = string.Empty;

    public int DisplayOrder { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<SubCategory> SubCategories { get; set; } = new List<SubCategory>();
}
