namespace ProductMarketplace.Domain.Entities;

/// <summary>
/// Admin-configurable catalog of documents that can be requested during an application.
/// A null ProductTypeId means the document applies to every product type (e.g. PAN Card);
/// a set ProductTypeId scopes it to just that type (e.g. a Vehicle RC for Vehicle Loan).
/// Replaces what used to be a hardcoded document list in the Apply Now flow.
/// </summary>
public class DocumentDefinition
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    public string DocumentType { get; set; } = string.Empty;
    public bool Required { get; set; } = true;
    public int SortOrder { get; set; }
    public bool Active { get; set; } = true;

    public Guid? ProductTypeId { get; set; }
    public ProductType? ProductType { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
