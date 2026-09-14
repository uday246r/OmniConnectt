namespace ProductMarketplace.Domain.Entities;

/// <summary>Records a single product-detail view event with a timestamp, enabling real (non-cached) view trend analytics.</summary>
public class ProductViewLog
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProductId { get; set; }
    public Product Product { get; set; } = null!;
    public DateTime ViewedAt { get; set; } = DateTime.UtcNow;
}
