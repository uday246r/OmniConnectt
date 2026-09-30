using ProductMarketplace.Domain.Enums;

namespace ProductMarketplace.Domain.Entities;

/// <summary>
/// One attribute every product of a sub-category carries — "Interest Rate" for Home Loan, "Annual Fee"
/// for a card. Drives how a product's card and details are rendered and how its values are validated.
/// </summary>
public class FieldDefinition
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid SubCategoryId { get; set; }
    public SubCategory SubCategory { get; set; } = null!;

    public string Key { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public FieldDataType DataType { get; set; }
    public string? Unit { get; set; }

    /// <summary>The choices for a Dropdown or MultiSelect field, as a JSON array of strings.</summary>
    public string? OptionsJson { get; set; }

    /// <summary>
    /// Format rules for this field's value, as a JSON array of <c>{ type, pattern, value, message }</c> —
    /// the same shape lead and user fields use, evaluated by the shared field-rule engine so the browser
    /// and this service hold a value to identical rules. Null means no rules beyond the data type.
    /// </summary>
    public string? ValidationsJson { get; set; }

    public bool Required { get; set; }
    public bool Filterable { get; set; }
    public bool Sortable { get; set; }
    public bool DisplayOnCard { get; set; }
    public bool DisplayOnDetails { get; set; } = true;
    public bool IsReadOnly { get; set; }
    public bool IsPrimaryMetric { get; set; }
    public bool IsSecondaryMetric { get; set; }
    public int SortOrder { get; set; }

    public ICollection<ProductFieldValue> Values { get; set; } = new List<ProductFieldValue>();
}
