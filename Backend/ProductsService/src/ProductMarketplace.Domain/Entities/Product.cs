namespace ProductMarketplace.Domain.Entities;

/// <summary>
/// One sellable offering: "Home Loan – Salaried" at a stated rate and amount range.
/// </summary>
/// <remarks>
/// Its category is not stored. It is reached through <see cref="SubCategory"/>, so moving a sub-category
/// to another category moves every product beneath it and no product can disagree with the hierarchy.
/// What the product actually offers — rate, fees, tenure — lives in <see cref="FieldValues"/>, shaped by
/// the sub-category's field definitions rather than by columns here.
/// </remarks>
public class Product
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid SubCategoryId { get; set; }
    public SubCategory SubCategory { get; set; } = null!;

    public string Name { get; set; } = string.Empty;

    /// <summary>Unique across the catalogue (CC_CASH_001). Leads reference a product by id and keep this as a snapshot.</summary>
    public string Code { get; set; } = string.Empty;

    public string ShortDescription { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string IconKey { get; set; } = string.Empty;

    /// <summary>A value from <see cref="StatusConfig"/> for the Product entity type.</summary>
    public string Status { get; set; } = string.Empty;

    public int ViewCount { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<ProductFieldValue> FieldValues { get; set; } = new List<ProductFieldValue>();
    public ICollection<ProductBenefit> Benefits { get; set; } = new List<ProductBenefit>();
    public ICollection<ProductEligibility> EligibilityCriteria { get; set; } = new List<ProductEligibility>();
}
