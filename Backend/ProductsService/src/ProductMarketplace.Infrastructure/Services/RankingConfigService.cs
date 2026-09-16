using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Application.Common;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;
using ProductMarketplace.Domain.Entities;
using ProductMarketplace.Infrastructure.Data;

namespace ProductMarketplace.Infrastructure.Services;

public class RankingConfigService : IRankingConfigService
{
    private readonly AppDbContext _db;
    private readonly IAuditLogService _audit;

    public RankingConfigService(AppDbContext db, IAuditLogService audit)
    {
        _db = db;
        _audit = audit;
    }

    public async Task<RankingConfigDto> GetConfigAsync(CancellationToken ct = default)
    {
        var config = await _db.RankingConfigs.AsNoTracking().FirstOrDefaultAsync(ct);
        if (config is null)
        {
            config = new RankingConfig
            {
                TrendingViewWeight = 1.0,
                TrendingApplicationWeight = 3.0,
                RecommendedRatingWeight = 20.0,
                RecommendedApplicationWeight = 0.5,
                RecommendedPromotionWeight = 25.0,
                UpdatedAt = DateTime.UtcNow
            };
            _db.RankingConfigs.Add(config);
            await _db.SaveChangesAsync(ct);
        }

        return config.ToDto();
    }

    public async Task<RankingConfigDto> UpdateConfigAsync(RankingConfigUpdateDto dto, CancellationToken ct = default)
    {
        var config = await _db.RankingConfigs.FirstOrDefaultAsync(ct);
        if (config is null)
        {
            config = new RankingConfig();
            _db.RankingConfigs.Add(config);
        }

        config.TrendingViewWeight = dto.TrendingViewWeight;
        config.TrendingApplicationWeight = dto.TrendingApplicationWeight;
        config.RecommendedRatingWeight = dto.RecommendedRatingWeight;
        config.RecommendedApplicationWeight = dto.RecommendedApplicationWeight;
        config.RecommendedPromotionWeight = dto.RecommendedPromotionWeight;
        config.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);

        await _audit.LogAsync(
            AuditActions.UpdateRankingConfig,
            AuditEntityTypes.RankingConfig,
            config.Id,
            "Marketplace Ranking Config",
            $"Updated ranking weights: Trending(View:{dto.TrendingViewWeight}, App:{dto.TrendingApplicationWeight}), Rec(Rating:{dto.RecommendedRatingWeight}, App:{dto.RecommendedApplicationWeight}, Promo:{dto.RecommendedPromotionWeight})",
            ct: ct);

        return config.ToDto();
    }
}
