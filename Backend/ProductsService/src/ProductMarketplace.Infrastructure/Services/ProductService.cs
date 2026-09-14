using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Application.Common;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;
using ProductMarketplace.Domain.Entities;
using ProductMarketplace.Infrastructure.Data;

namespace ProductMarketplace.Infrastructure.Services;

public class ProductService : IProductService
{
    private readonly AppDbContext _db;
    private readonly IAuditLogService _audit;
    private readonly IRankingConfigService _rankingConfig;
    public ProductService(AppDbContext db, IAuditLogService audit, IRankingConfigService rankingConfig)
    {
        _db = db;
        _audit = audit;
        _rankingConfig = rankingConfig;
    }

    private IQueryable<Product> FullGraph() => _db.Products
        .Include(p => p.Category)
        .Include(p => p.ProductType)
        .Include(p => p.FieldValues).ThenInclude(v => v.FieldDefinition)
        .Include(p => p.Benefits)
        .Include(p => p.EligibilityCriteria)
        .Include(p => p.Reviews)
        .Include(p => p.Promotions);

    public async Task<PagedResult<ProductListItemDto>> SearchAsync(ProductQueryDto query, CancellationToken ct = default)
    {
        var q = FullGraph().AsQueryable();

        if (query.CategoryId.HasValue) q = q.Where(p => p.CategoryId == query.CategoryId);
        if (query.ProductTypeId.HasValue) q = q.Where(p => p.ProductTypeId == query.ProductTypeId);
        if (!string.IsNullOrWhiteSpace(query.Status))
            q = q.Where(p => p.Status == query.Status);
        if (query.MinRating.HasValue) q = q.Where(p => p.RatingAverage >= query.MinRating.Value);

        var term = query.Search?.Trim();
        if (!string.IsNullOrWhiteSpace(term))
        {
            var lower = term.ToLower();
            q = q.Where(p =>
                p.Name.ToLower().Contains(lower) ||
                p.ShortDescription.ToLower().Contains(lower) ||
                p.Description.ToLower().Contains(lower) ||
                p.Category.Name.ToLower().Contains(lower) ||
                p.ProductType.Name.ToLower().Contains(lower) ||
                p.Benefits.Any(b => b.Title.ToLower().Contains(lower)) ||
                p.FieldValues.Any(v => v.Value.ToLower().Contains(lower)));

            await RecordSearchTermAsync(lower, ct);
            await _audit.LogAsync(AuditActions.Search, AuditEntityTypes.Search, null, term,
                $"Searched products for \"{term}\"", ct: ct);
        }

        var all = await q.ToListAsync(ct);
        var now = DateTime.UtcNow;
        var ranking = await _rankingConfig.GetConfigAsync(ct);

        IEnumerable<Product> sorted = query.Sort.ToLowerInvariant() switch
        {
            "trending" => all.OrderByDescending(p => p.ViewCount * ranking.TrendingViewWeight + p.ApplicationCount * ranking.TrendingApplicationWeight),
            "lowest-rate" => all.OrderBy(p => PrimaryNumeric(p) ?? decimal.MaxValue),
            "newly-added" => all.OrderByDescending(p => p.CreatedAt),
            "top-rated" => all.OrderByDescending(p => p.RatingAverage).ThenByDescending(p => p.RatingCount),
            "most-applied" => all.OrderByDescending(p => p.ApplicationCount),
            _ => all.OrderByDescending(p => p.RatingAverage * ranking.RecommendedRatingWeight + p.ApplicationCount * ranking.RecommendedApplicationWeight + (p.Promotions.Any(x => x.IsPromotionActive(now)) ? ranking.RecommendedPromotionWeight : 0))
        };

        var total = all.Count;
        var page = query.Page < 1 ? 1 : query.Page;
        var pageSize = query.PageSize < 1 ? 8 : query.PageSize;
        var items = sorted.Skip((page - 1) * pageSize).Take(pageSize).Select(p => p.ToListItemDto(now)).ToList();

        return new PagedResult<ProductListItemDto> { Items = items, Page = page, PageSize = pageSize, TotalCount = total };
    }

    private static decimal? PrimaryNumeric(Product p)
    {
        var primary = p.FieldValues.FirstOrDefault(v => v.FieldDefinition != null && v.FieldDefinition.IsPrimaryMetric);
        return primary?.NumericValue;
    }

    private async Task RecordSearchTermAsync(string term, CancellationToken ct)
    {
        var existing = await _db.SearchLogs.FirstOrDefaultAsync(s => s.Term == term, ct);
        if (existing is null)
        {
            _db.SearchLogs.Add(new SearchLog { Term = term, HitCount = 1, LastSearchedAt = DateTime.UtcNow });
        }
        else
        {
            existing.HitCount++;
            existing.LastSearchedAt = DateTime.UtcNow;
        }
        await _db.SaveChangesAsync(ct);
    }

    public async Task<ProductDetailDto?> GetByIdAsync(Guid id, bool trackView, CancellationToken ct = default)
    {
        if (trackView)
        {
            await _db.Products.Where(p => p.Id == id).ExecuteUpdateAsync(s => s.SetProperty(p => p.ViewCount, p => p.ViewCount + 1), ct);
            _db.ProductViewLogs.Add(new ProductViewLog { ProductId = id, ViewedAt = DateTime.UtcNow });
            await _db.SaveChangesAsync(ct);
        }

        var p = await FullGraph().AsNoTracking().FirstOrDefaultAsync(p => p.Id == id, ct);
        if (p is null) return null;

        if (trackView)
        {
            await _audit.LogAsync(AuditActions.ViewProduct, AuditEntityTypes.Product, p.Id, p.Name, $"Viewed product details for \"{p.Name}\"", ct: ct);
        }
        return p.ToDetailDto(DateTime.UtcNow);
    }

    public async Task<ProductDetailDto> CreateAsync(ProductCreateUpdateDto dto, CancellationToken ct = default)
    {
        var productType = await _db.ProductTypes.Include(t => t.FieldDefinitions).FirstOrDefaultAsync(t => t.Id == dto.ProductTypeId, ct)
            ?? throw new InvalidOperationException("Invalid product type.");
        await StatusValidation.EnsureValidAsync(_db, StatusEntityTypes.Product, dto.Status, ct);

        if (await _db.Products.AnyAsync(p => p.Code == dto.Code, ct))
            throw new InvalidOperationException($"A product with code \"{dto.Code}\" already exists.");

        var product = new Product
        {
            Name = dto.Name,
            Code = dto.Code,
            ShortDescription = dto.ShortDescription,
            Description = dto.Description,
            IconKey = dto.IconKey,
            CategoryId = dto.CategoryId,
            ProductTypeId = dto.ProductTypeId,
            Status = dto.Status,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        ApplyFieldValues(product, productType, dto.FieldValues);
        ApplyBenefits(product, dto.Benefits);
        ApplyEligibility(product, dto.EligibilityCriteria);

        _db.Products.Add(product);
        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(AuditActions.CreateProduct, AuditEntityTypes.Product, product.Id, product.Name, $"Created product \"{product.Name}\"", ct: ct);
        return (await FullGraph().FirstAsync(p => p.Id == product.Id, ct)).ToDetailDto(DateTime.UtcNow);
    }

    public async Task<ProductDetailDto?> UpdateAsync(Guid id, ProductCreateUpdateDto dto, CancellationToken ct = default)
    {
        var product = await _db.Products
            .Include(p => p.FieldValues).ThenInclude(v => v.FieldDefinition)
            .Include(p => p.Benefits)
            .Include(p => p.EligibilityCriteria)
            .FirstOrDefaultAsync(p => p.Id == id, ct);
        if (product is null) return null;

        var productType = await _db.ProductTypes.Include(t => t.FieldDefinitions).FirstOrDefaultAsync(t => t.Id == dto.ProductTypeId, ct)
            ?? throw new InvalidOperationException("Invalid product type.");
        await StatusValidation.EnsureValidAsync(_db, StatusEntityTypes.Product, dto.Status, ct);

        if (await _db.Products.AnyAsync(p => p.Code == dto.Code && p.Id != id, ct))
            throw new InvalidOperationException($"A product with code \"{dto.Code}\" already exists.");

        product.Name = dto.Name;
        product.Code = dto.Code;
        product.ShortDescription = dto.ShortDescription;
        product.Description = dto.Description;
        product.IconKey = dto.IconKey;
        product.CategoryId = dto.CategoryId;
        product.ProductTypeId = dto.ProductTypeId;
        product.Status = dto.Status;
        product.UpdatedAt = DateTime.UtcNow;

        _db.ProductFieldValues.RemoveRange(product.FieldValues);
        _db.ProductBenefits.RemoveRange(product.Benefits);
        _db.ProductEligibilities.RemoveRange(product.EligibilityCriteria);
        product.FieldValues.Clear();
        product.Benefits.Clear();
        product.EligibilityCriteria.Clear();

        ApplyFieldValues(product, productType, dto.FieldValues);
        ApplyBenefits(product, dto.Benefits);
        ApplyEligibility(product, dto.EligibilityCriteria);

        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(AuditActions.UpdateProduct, AuditEntityTypes.Product, product.Id, product.Name, $"Updated product \"{product.Name}\"", ct: ct);
        return (await FullGraph().FirstAsync(p => p.Id == id, ct)).ToDetailDto(DateTime.UtcNow);
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var product = await _db.Products.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id, ct);
        if (product is null) return false;
        var hasApplications = await _db.Applications.AsNoTracking().AnyAsync(a => a.ProductId == id, ct);
        if (hasApplications) throw new InvalidOperationException("Cannot delete a product that has applications submitted against it. Deactivate it instead.");

        await _db.ProductViewLogs.Where(v => v.ProductId == id).ExecuteDeleteAsync(ct);
        await _db.ProductFieldValues.Where(f => f.ProductId == id).ExecuteDeleteAsync(ct);
        await _db.ProductBenefits.Where(b => b.ProductId == id).ExecuteDeleteAsync(ct);
        await _db.ProductEligibilities.Where(e => e.ProductId == id).ExecuteDeleteAsync(ct);
        await _db.Promotions.Where(pr => pr.ProductId == id).ExecuteDeleteAsync(ct);
        await _db.Reviews.Where(r => r.ProductId == id).ExecuteDeleteAsync(ct);
        await _db.Products.Where(p => p.Id == id).ExecuteDeleteAsync(ct);

        await _audit.LogAsync(AuditActions.DeleteProduct, AuditEntityTypes.Product, id, product.Name, $"Deleted product \"{product.Name}\"", ct: ct);
        return true;
    }

    public async Task<ProductDetailDto?> UpdateStatusAsync(Guid id, string status, CancellationToken ct = default)
    {
        var product = await _db.Products.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (product is null) return null;
        await StatusValidation.EnsureValidAsync(_db, StatusEntityTypes.Product, status, ct);
        var previousStatus = product.Status;
        product.Status = status;
        product.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(AuditActions.ProductStatusChange, AuditEntityTypes.Product, product.Id, product.Name,
            $"Changed status of \"{product.Name}\" from {previousStatus} to {product.Status}", previousValue: previousStatus, newValue: product.Status.ToString(), ct: ct);
        return (await FullGraph().FirstAsync(p => p.Id == id, ct)).ToDetailDto(DateTime.UtcNow);
    }

    public async Task<List<TopPerformerDto>> GetTopPerformersAsync(string metric, int take, CancellationToken ct = default)
    {
        var query = _db.Products.AsNoTracking().Include(p => p.Category).Where(p => p.Status == "Active");

        IOrderedQueryable<Product> ordered = metric.ToLowerInvariant() switch
        {
            "viewed" => query.OrderByDescending(p => p.ViewCount),
            "rated" => query.OrderByDescending(p => p.RatingAverage).ThenByDescending(p => p.RatingCount),
            _ => query.OrderByDescending(p => p.ApplicationCount)
        };

        return await ordered.Take(take).Select(p => new TopPerformerDto
        {
            Id = p.Id,
            Name = p.Name,
            CategoryName = p.Category.Name,
            IconKey = p.IconKey,
            ApplicationCount = p.ApplicationCount,
            ViewCount = p.ViewCount,
            RatingAverage = p.RatingAverage,
            RatingCount = p.RatingCount
        }).ToListAsync(ct);
    }

    private static void ApplyFieldValues(Product product, ProductType type, List<ProductFieldValueInputDto> values)
    {
        foreach (var input in values)
        {
            var def = type.FieldDefinitions.FirstOrDefault(f => f.Id == input.FieldDefinitionId);
            if (def is null) continue;
            decimal? numeric = decimal.TryParse(input.Value, out var d) ? d : null;
            product.FieldValues.Add(new ProductFieldValue
            {
                ProductId = product.Id,
                FieldDefinitionId = def.Id,
                FieldDefinition = def,
                Value = input.Value,
                NumericValue = numeric
            });
        }
    }

    private static void ApplyBenefits(Product product, List<ProductBenefitInputDto> benefits)
    {
        int order = 0;
        foreach (var b in benefits)
            product.Benefits.Add(new ProductBenefit { ProductId = product.Id, Title = b.Title, Description = b.Description, IconKey = b.IconKey, SortOrder = order++ });
    }

    private static void ApplyEligibility(Product product, List<ProductEligibilityInputDto> items)
    {
        int order = 0;
        foreach (var e in items)
            product.EligibilityCriteria.Add(new ProductEligibility { ProductId = product.Id, Criteria = e.Criteria, Description = e.Description, SortOrder = order++ });
    }
}
