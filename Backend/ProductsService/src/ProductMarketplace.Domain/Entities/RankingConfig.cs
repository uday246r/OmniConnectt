namespace ProductMarketplace.Domain.Entities;

public class RankingConfig
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public double TrendingViewWeight { get; set; } = 1.0;
    public double TrendingApplicationWeight { get; set; } = 3.0;
    public double RecommendedRatingWeight { get; set; } = 20.0;
    public double RecommendedApplicationWeight { get; set; } = 0.5;
    public double RecommendedPromotionWeight { get; set; } = 25.0;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
