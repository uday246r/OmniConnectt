namespace ProductMarketplace.Application.Dtos;

public class FieldDefinitionDto
{
    public Guid Id { get; set; }
    public string Key { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string DataType { get; set; } = string.Empty;
    public string? Unit { get; set; }
    public List<string>? Options { get; set; }
    public bool Required { get; set; }
    public bool Filterable { get; set; }
    public bool VisibleToCustomer { get; set; }
    public bool Sortable { get; set; }
    public bool DisplayOnCard { get; set; }
    public bool DisplayOnDetails { get; set; }
    public bool DisplayInApplication { get; set; }
    public bool IsReadOnly { get; set; }
    public bool IsPrimaryMetric { get; set; }
    public bool IsSecondaryMetric { get; set; }
    public int SortOrder { get; set; }
}

public class FieldDefinitionCreateUpdateDto
{
    public Guid? Id { get; set; }
    public string Key { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string DataType { get; set; } = "Text";
    public string? Unit { get; set; }
    public List<string>? Options { get; set; }
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
}

public class ProductFieldValueDto
{
    public Guid FieldDefinitionId { get; set; }
    public string Key { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string DataType { get; set; } = string.Empty;
    public string? Unit { get; set; }
    public string Value { get; set; } = string.Empty;
    public bool DisplayOnCard { get; set; }
    public bool DisplayOnDetails { get; set; }
    public bool IsReadOnly { get; set; }
    public bool IsPrimaryMetric { get; set; }
    public bool IsSecondaryMetric { get; set; }
}

public class ProductFieldValueInputDto
{
    public Guid FieldDefinitionId { get; set; }
    public string Value { get; set; } = string.Empty;
}

public class ProductTypeDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string IconKey { get; set; } = string.Empty;
    public string ApplyButtonLabel { get; set; } = "Apply Now";
    public string AmountFieldLabel { get; set; } = "Requested Amount";
    public string ShortLabel { get; set; } = string.Empty;
    public int ProductCount { get; set; }
    public List<FieldDefinitionDto> FieldDefinitions { get; set; } = new();
}

public class ProductTypeCreateUpdateDto
{
    public string Name { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string IconKey { get; set; } = "package";
    public string ApplyButtonLabel { get; set; } = "Apply Now";
    public string AmountFieldLabel { get; set; } = "Requested Amount";
    public string ShortLabel { get; set; } = string.Empty;
}

public class DocumentDefinitionDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string DocumentType { get; set; } = string.Empty;
    public bool Required { get; set; }
    public int SortOrder { get; set; }
    public bool Active { get; set; }
    public Guid? ProductTypeId { get; set; }
    public string? ProductTypeName { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class DocumentDefinitionCreateUpdateDto
{
    public string Name { get; set; } = string.Empty;
    public string DocumentType { get; set; } = string.Empty;
    public bool Required { get; set; } = true;
    public int SortOrder { get; set; }
    public bool Active { get; set; } = true;
    public Guid? ProductTypeId { get; set; }
}
