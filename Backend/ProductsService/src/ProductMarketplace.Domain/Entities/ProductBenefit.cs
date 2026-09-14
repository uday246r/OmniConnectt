namespace ProductMarketplace.Domain.Entities;

public class ProductBenefit
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProductId { get; set; }
    public Product Product { get; set; } = null!;

    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string IconKey { get; set; } = "check";
    public int SortOrder { get; set; }
}
