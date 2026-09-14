namespace ProductMarketplace.Domain.Entities;

public class Product
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string ShortDescription { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string IconKey { get; set; } = "package";

    public Guid CategoryId { get; set; }
    public Category Category { get; set; } = null!;

    public Guid ProductTypeId { get; set; }
    public ProductType ProductType { get; set; } = null!;

    public string Status { get; set; } = "Draft";

    public double RatingAverage { get; set; }
    public int RatingCount { get; set; }
    public int ApplicationCount { get; set; }
    public int ViewCount { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<ProductFieldValue> FieldValues { get; set; } = new List<ProductFieldValue>();
    public ICollection<ProductBenefit> Benefits { get; set; } = new List<ProductBenefit>();
    public ICollection<ProductEligibility> EligibilityCriteria { get; set; } = new List<ProductEligibility>();
    public ICollection<Review> Reviews { get; set; } = new List<Review>();
    public ICollection<Promotion> Promotions { get; set; } = new List<Promotion>();
    public ICollection<Application> Applications { get; set; } = new List<Application>();
    public ICollection<ProductViewLog> ViewLogs { get; set; } = new List<ProductViewLog>();
}
