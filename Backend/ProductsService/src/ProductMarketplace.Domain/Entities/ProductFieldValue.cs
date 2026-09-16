namespace ProductMarketplace.Domain.Entities;

public class ProductFieldValue
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProductId { get; set; }
    public Product Product { get; set; } = null!;

    public Guid FieldDefinitionId { get; set; }
    public FieldDefinition FieldDefinition { get; set; } = null!;

    public string Value { get; set; } = string.Empty;
    /// <summary>Numeric projection of Value used for sorting/filtering when DataType is Number/Currency/Percentage.</summary>
    public decimal? NumericValue { get; set; }
}
