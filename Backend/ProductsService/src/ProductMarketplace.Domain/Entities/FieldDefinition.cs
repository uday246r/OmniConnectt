using ProductMarketplace.Domain.Enums;

namespace ProductMarketplace.Domain.Entities;

/// <summary>
/// Defines a dynamic attribute available to products of a given ProductType (e.g. "Interest Rate" for Loan).
/// This drives the configurable product card / details / application form rendering.
/// </summary>
public class FieldDefinition
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProductTypeId { get; set; }
    public ProductType ProductType { get; set; } = null!;

    public string Key { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public FieldDataType DataType { get; set; }
    public string? Unit { get; set; }
    public string? OptionsJson { get; set; }

    public bool Required { get; set; }
    public bool Filterable { get; set; }
    public bool VisibleToCustomer { get; set; } = true;
    public bool Sortable { get; set; }
    public bool DisplayOnCard { get; set; }
    public bool DisplayOnDetails { get; set; } = true;
    public bool DisplayInApplication { get; set; }
    public bool IsReadOnly { get; set; }
    public bool IsPrimaryMetric { get; set; }
    public bool IsSecondaryMetric { get; set; }
    public int SortOrder { get; set; }

    public ICollection<ProductFieldValue> Values { get; set; } = new List<ProductFieldValue>();
    public ICollection<ApplicationFieldValue> ApplicationValues { get; set; } = new List<ApplicationFieldValue>();
}
