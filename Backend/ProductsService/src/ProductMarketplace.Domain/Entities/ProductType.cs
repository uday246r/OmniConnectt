namespace ProductMarketplace.Domain.Entities;

public class ProductType
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string IconKey { get; set; } = "package";
    public string ApplyButtonLabel { get; set; } = "Apply Now";
    public string AmountFieldLabel { get; set; } = "Requested Amount";
    public string ShortLabel { get; set; } = string.Empty;

    public ICollection<Product> Products { get; set; } = new List<Product>();
    public ICollection<FieldDefinition> FieldDefinitions { get; set; } = new List<FieldDefinition>();
    public ICollection<DocumentDefinition> DocumentDefinitions { get; set; } = new List<DocumentDefinition>();
}
