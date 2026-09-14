namespace ProductMarketplace.Domain.Entities;

public class ApplicationFieldValue
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ApplicationId { get; set; }
    public Application Application { get; set; } = null!;

    public Guid? FieldDefinitionId { get; set; }
    public FieldDefinition? FieldDefinition { get; set; }

    public string FieldKey { get; set; } = string.Empty;
    public string FieldLabel { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
}
