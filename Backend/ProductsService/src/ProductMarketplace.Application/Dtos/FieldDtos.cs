namespace ProductMarketplace.Application.Dtos;

/// <summary>One format rule on a field. The same shape lead and user fields use, so one engine evaluates all three.</summary>
public class FieldRuleDto
{
    public string Type { get; set; } = string.Empty;
    public string? Pattern { get; set; }
    public int? Value { get; set; }
    public string Message { get; set; } = string.Empty;
}

public class FieldDefinitionDto
{
    public Guid Id { get; set; }
    public Guid SubCategoryId { get; set; }
    public string Key { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string DataType { get; set; } = string.Empty;
    public string? Unit { get; set; }
    public List<string>? Options { get; set; }
    public List<FieldRuleDto> Validations { get; set; } = new();
    public bool Required { get; set; }
    public bool Filterable { get; set; }
    public bool Sortable { get; set; }
    public bool DisplayOnCard { get; set; }
    public bool DisplayOnDetails { get; set; }
    public bool IsReadOnly { get; set; }
    public bool IsPrimaryMetric { get; set; }
    public bool IsSecondaryMetric { get; set; }
    public int SortOrder { get; set; }
}

public class FieldDefinitionCreateUpdateDto
{
    public string Key { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string DataType { get; set; } = string.Empty;
    public string? Unit { get; set; }
    public List<string>? Options { get; set; }
    public List<FieldRuleDto>? Validations { get; set; }
    public bool Required { get; set; }
    public bool Filterable { get; set; }
    public bool Sortable { get; set; }
    public bool DisplayOnCard { get; set; }
    public bool DisplayOnDetails { get; set; } = true;
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

public class DocumentDefinitionDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string DocumentType { get; set; } = string.Empty;
    public bool Required { get; set; }
    public int SortOrder { get; set; }
    public bool Active { get; set; }

    /// <summary>Null when the document applies to every product.</summary>
    public Guid? SubCategoryId { get; set; }
    public string? SubCategoryName { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class DocumentDefinitionCreateUpdateDto
{
    public string Name { get; set; } = string.Empty;
    public string DocumentType { get; set; } = string.Empty;
    public bool Required { get; set; } = true;
    public int SortOrder { get; set; }
    public bool Active { get; set; } = true;
    public Guid? SubCategoryId { get; set; }
}
