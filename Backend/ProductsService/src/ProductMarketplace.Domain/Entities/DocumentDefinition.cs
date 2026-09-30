namespace ProductMarketplace.Domain.Entities;

/// <summary>
/// A document a customer is asked for. A null <see cref="SubCategoryId"/> means it applies to every
/// product (an identity proof); a set one scopes it to that sub-category (property papers for a home loan).
/// </summary>
public class DocumentDefinition
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    public string DocumentType { get; set; } = string.Empty;
    public bool Required { get; set; } = true;
    public int SortOrder { get; set; }
    public bool Active { get; set; } = true;

    public Guid? SubCategoryId { get; set; }
    public SubCategory? SubCategory { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
