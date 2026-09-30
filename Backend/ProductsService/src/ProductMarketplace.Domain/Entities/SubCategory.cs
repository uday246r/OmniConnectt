namespace ProductMarketplace.Domain.Entities;

/// <summary>
/// A kind of product within a category: Home Loan, Car Loan, Cashback Card.
/// </summary>
/// <remarks>
/// <para>
/// A sub-category is a <i>type</i>; a <see cref="Product"/> is an <i>offering</i>. A bank does not have
/// one home loan — it has "Home Loan – Salaried", "Home Loan – Self Employed" and a balance-transfer
/// variant, all under the one "Home Loan" sub-category.
/// </para>
/// <para>
/// That is why the sub-category, not the product, owns the things every offering of a type shares: which
/// attributes it has (<see cref="FieldDefinitions"/>) and which documents it needs
/// (<see cref="DocumentDefinitions"/>). Configured once here, every product beneath it inherits them, so
/// adding the tenth home loan means filling in values rather than rebuilding a form. This replaces the old
/// ProductType, which carried the same responsibilities under a name that made every product look
/// classified twice.
/// </para>
/// </remarks>
public class SubCategory
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid CategoryId { get; set; }
    public Category Category { get; set; } = null!;

    public string Name { get; set; } = string.Empty;

    /// <summary>Short, stable, upper-case identifier (LN-HM). Unique across the catalogue, so a code names one sub-category unambiguously in reports and leads.</summary>
    public string Code { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;
    public string IconKey { get; set; } = string.Empty;

    /// <summary>A value from <see cref="StatusConfig"/> for the SubCategory entity type.</summary>
    public string Status { get; set; } = string.Empty;

    public int DisplayOrder { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<Product> Products { get; set; } = new List<Product>();
    public ICollection<FieldDefinition> FieldDefinitions { get; set; } = new List<FieldDefinition>();
    public ICollection<DocumentDefinition> DocumentDefinitions { get; set; } = new List<DocumentDefinition>();
}
