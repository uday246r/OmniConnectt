using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Application.Common;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;
using ProductMarketplace.Domain.Entities;
using ProductMarketplace.Infrastructure.Data;

namespace ProductMarketplace.Infrastructure.Services;

public class ReviewService : IReviewService
{
    private readonly AppDbContext _db;
    private readonly IAuditLogService _audit;
    public ReviewService(AppDbContext db, IAuditLogService audit)
    {
        _db = db;
        _audit = audit;
    }

    private IQueryable<Review> Base() => _db.Reviews.Include(r => r.Product);

    public async Task<PagedResult<ReviewDto>> SearchAsync(ReviewQueryDto query, CancellationToken ct = default)
    {
        var q = Base().AsQueryable();
        if (query.ProductId.HasValue) q = q.Where(r => r.ProductId == query.ProductId);
        if (query.Rating.HasValue) q = q.Where(r => r.Rating == query.Rating);
        if (!string.IsNullOrWhiteSpace(query.Status))
            q = q.Where(r => r.Status == query.Status);
        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var lower = query.Search.ToLower();
            q = q.Where(r => r.CustomerName.ToLower().Contains(lower) || r.Comment.ToLower().Contains(lower) || r.Product.Name.ToLower().Contains(lower));
        }

        var total = await q.CountAsync(ct);
        var items = await q.OrderByDescending(r => r.CreatedAt)
            .Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            .ToListAsync(ct);

        return new PagedResult<ReviewDto> { Items = items.Select(r => r.ToDto()).ToList(), Page = query.Page, PageSize = query.PageSize, TotalCount = total };
    }

    public async Task<ReviewDto?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        var r = await Base().FirstOrDefaultAsync(r => r.Id == id, ct);
        return r?.ToDto();
    }

    public async Task<ReviewDto> CreateAsync(ReviewCreateDto dto, CancellationToken ct = default)
    {
        var product = await _db.Products.FirstOrDefaultAsync(p => p.Id == dto.ProductId, ct)
            ?? throw new InvalidOperationException("Product not found.");

        var review = new Review
        {
            ProductId = dto.ProductId,
            Product = product,
            CustomerName = dto.CustomerName,
            CustomerEmail = dto.CustomerEmail,
            Rating = Math.Clamp(dto.Rating, 1, 5),
            Comment = dto.Comment,
            Status = "Pending",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        _db.Reviews.Add(review);
        await _db.SaveChangesAsync(ct);
        var created = await Base().FirstAsync(r => r.Id == review.Id, ct);
        await _audit.LogAsync(AuditActions.CreateReview, AuditEntityTypes.Review, review.Id, created.Product?.Name ?? product.Name,
            $"New {review.Rating}-star review submitted for \"{created.Product?.Name ?? product.Name}\" by {review.CustomerName}", ct: ct);
        return created.ToDto();
    }

    public async Task<ReviewDto?> UpdateStatusAsync(Guid id, string status, CancellationToken ct = default)
    {
        var review = await _db.Reviews.Include(r => r.Product).FirstOrDefaultAsync(r => r.Id == id, ct);
        if (review is null) return null;
        await StatusValidation.EnsureValidAsync(_db, StatusEntityTypes.Review, status, ct);
        var previousStatus = review.Status;
        review.Status = status;
        review.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        await RecalculateProductRatingAsync(review.ProductId, ct);
        await _audit.LogAsync(AuditActions.ReviewStatusChange, AuditEntityTypes.Review, review.Id, review.Product.Name,
            $"Changed review by {review.CustomerName} on \"{review.Product.Name}\" from {previousStatus} to {review.Status}",
            previousValue: previousStatus, newValue: review.Status.ToString(), ct: ct);
        return (await Base().FirstAsync(r => r.Id == id, ct)).ToDto();
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var review = await _db.Reviews.Include(r => r.Product).FirstOrDefaultAsync(r => r.Id == id, ct);
        if (review is null) return false;
        var productId = review.ProductId;
        _db.Reviews.Remove(review);
        await _db.SaveChangesAsync(ct);
        await RecalculateProductRatingAsync(productId, ct);
        await _audit.LogAsync(AuditActions.DeleteReview, AuditEntityTypes.Review, id, review.Product.Name,
            $"Deleted review by {review.CustomerName} on \"{review.Product.Name}\"", ct: ct);
        return true;
    }

    private async Task RecalculateProductRatingAsync(Guid productId, CancellationToken ct)
    {
        var product = await _db.Products.FirstOrDefaultAsync(p => p.Id == productId, ct);
        if (product is null) return;
        // Aggregated in the database rather than loading every published review of the product.
        var published = _db.Reviews.Where(r => r.ProductId == productId && r.Status == "Published");
        product.RatingCount = await published.CountAsync(ct);
        product.RatingAverage = product.RatingCount == 0 ? 0 : Math.Round(await published.AverageAsync(r => (double)r.Rating, ct), 1);
        await _db.SaveChangesAsync(ct);
    }
}
