namespace ProductMarketplace.Application.Dtos;

public class RankingConfigDto
{
    public Guid Id { get; set; }
    public double TrendingViewWeight { get; set; }
    public double TrendingApplicationWeight { get; set; }
    public double RecommendedRatingWeight { get; set; }
    public double RecommendedApplicationWeight { get; set; }
    public double RecommendedPromotionWeight { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class RankingConfigUpdateDto
{
    public double TrendingViewWeight { get; set; } = 1.0;
    public double TrendingApplicationWeight { get; set; } = 3.0;
    public double RecommendedRatingWeight { get; set; } = 20.0;
    public double RecommendedApplicationWeight { get; set; } = 0.5;
    public double RecommendedPromotionWeight { get; set; } = 25.0;
}
