using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Application.Common;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;
using ProductMarketplace.Domain.Entities;
using ProductMarketplace.Infrastructure.Data;

namespace ProductMarketplace.Infrastructure.Services;

public class PromotionService : IPromotionService
{
    private readonly AppDbContext _db;
    private readonly IAuditLogService _audit;
    public PromotionService(AppDbContext db, IAuditLogService audit)
    {
        _db = db;
        _audit = audit;
    }

    private IQueryable<Promotion> Base() => _db.Promotions.Include(p => p.Product).ThenInclude(p => p.Category);

    public async Task<PagedResult<PromotionDto>> SearchAsync(PromotionQueryDto query, CancellationToken ct = default)
    {
        var q = Base().AsQueryable();
        if (query.ProductId.HasValue) q = q.Where(p => p.ProductId == query.ProductId);
        if (!string.IsNullOrWhiteSpace(query.Status))
            q = q.Where(p => p.Status == query.Status);
        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var lower = query.Search.ToLower();
            q = q.Where(p => p.Title.ToLower().Contains(lower) || p.Product.Name.ToLower().Contains(lower));
        }

        var total = await q.CountAsync(ct);
        var items = await q.OrderByDescending(p => p.Priority).ThenByDescending(p => p.CreatedAt)
            .Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            .ToListAsync(ct);

        return new PagedResult<PromotionDto> { Items = items.Select(p => p.ToDto()).ToList(), Page = query.Page, PageSize = query.PageSize, TotalCount = total };
    }

    public async Task<PromotionDto?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        var p = await Base().FirstOrDefaultAsync(p => p.Id == id, ct);
        return p?.ToDto();
    }

    public async Task<PromotionDto> CreateAsync(PromotionCreateUpdateDto dto, CancellationToken ct = default)
    {
        var product = await _db.Products.Include(p => p.Category).FirstOrDefaultAsync(p => p.Id == dto.ProductId, ct)
            ?? throw new InvalidOperationException("Product not found.");
        await StatusValidation.EnsureValidAsync(_db, StatusEntityTypes.Promotion, dto.Status, ct);
        var promo = new Promotion
        {
            ProductId = dto.ProductId,
            Product = product,
            Title = dto.Title,
            Description = dto.Description,
            BadgeText = dto.BadgeText,
            OfferDetail = dto.OfferDetail,
            TermsAndConditions = dto.TermsAndConditions,
            StartDate = dto.StartDate,
            EndDate = dto.EndDate,
            Priority = dto.Priority,
            Status = dto.Status,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        _db.Promotions.Add(promo);
        await _db.SaveChangesAsync(ct);
        var created = await Base().FirstAsync(p => p.Id == promo.Id, ct);
        await _audit.LogAsync(AuditActions.CreatePromotion, AuditEntityTypes.Promotion, promo.Id, created.Title,
            $"Created promotion \"{created.Title}\" for {created.Product?.Name ?? product.Name}", ct: ct);
        return created.ToDto();
    }

    public async Task<PromotionDto?> UpdateAsync(Guid id, PromotionCreateUpdateDto dto, CancellationToken ct = default)
    {
        var promo = await _db.Promotions.Include(p => p.Product).FirstOrDefaultAsync(p => p.Id == id, ct);
        if (promo is null) return null;

        await StatusValidation.EnsureValidAsync(_db, StatusEntityTypes.Promotion, dto.Status, ct);
        promo.ProductId = dto.ProductId;
        promo.Title = dto.Title;
        promo.Description = dto.Description;
        promo.BadgeText = dto.BadgeText;
        promo.OfferDetail = dto.OfferDetail;
        promo.TermsAndConditions = dto.TermsAndConditions;
        promo.StartDate = dto.StartDate;
        promo.EndDate = dto.EndDate;
        promo.Priority = dto.Priority;
        promo.Status = dto.Status;
        promo.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(AuditActions.UpdatePromotion, AuditEntityTypes.Promotion, promo.Id, promo.Title, $"Updated promotion \"{promo.Title}\"", ct: ct);
        return (await Base().FirstAsync(p => p.Id == id, ct)).ToDto();
    }

    public async Task<PromotionDto?> UpdateStatusAsync(Guid id, string status, CancellationToken ct = default)
    {
        var promo = await _db.Promotions.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (promo is null) return null;
        await StatusValidation.EnsureValidAsync(_db, StatusEntityTypes.Promotion, status, ct);
        var previousStatus = promo.Status;
        promo.Status = status;
        promo.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(AuditActions.PromotionStatusChange, AuditEntityTypes.Promotion, promo.Id, promo.Title,
            $"Changed status of promotion \"{promo.Title}\" from {previousStatus} to {promo.Status}",
            previousValue: previousStatus, newValue: promo.Status.ToString(), ct: ct);
        return (await Base().FirstAsync(p => p.Id == id, ct)).ToDto();
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var promo = await _db.Promotions.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (promo is null) return false;
        _db.Promotions.Remove(promo);
        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(AuditActions.DeletePromotion, AuditEntityTypes.Promotion, id, promo.Title, $"Deleted promotion \"{promo.Title}\"", ct: ct);
        return true;
    }
}
