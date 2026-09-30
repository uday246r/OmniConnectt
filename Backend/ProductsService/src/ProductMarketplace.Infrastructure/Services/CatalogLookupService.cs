using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;
using ProductMarketplace.Infrastructure.Data;

namespace ProductMarketplace.Infrastructure.Services;

/// <inheritdoc cref="ICatalogLookupService"/>
/// <remarks>
/// Visibility comes from <see cref="CatalogVisibility"/> — the same rule the Products screen and the
/// dashboard use — so there is exactly one definition of "the catalogue shows this".
/// </remarks>
public sealed class CatalogLookupService(AppDbContext db, ICatalogStatuses statuses) : ICatalogLookupService
{
    public async Task<List<CatalogCategoryLookupDto>> GetCategoriesAsync(CancellationToken ct = default)
    {
        var visibility = await CatalogVisibility.LoadAsync(statuses, ct);

        var counts = await visibility.Visible(db.Products.AsNoTracking())
            .GroupBy(p => p.SubCategory.CategoryId)
            .Select(g => new { CategoryId = g.Key, Count = g.Count() })
            .ToListAsync(ct);
        var ids = counts.Select(c => c.CategoryId).ToArray();

        var categories = await db.Categories.AsNoTracking()
            .Where(c => ids.Contains(c.Id))
            .OrderBy(c => c.DisplayOrder).ThenBy(c => c.Name)
            .ToListAsync(ct);

        return categories.Select(c => new CatalogCategoryLookupDto
        {
            Id = c.Id,
            Name = c.Name,
            Code = c.Code,
            IconKey = c.IconKey,
            ProductCount = counts.First(x => x.CategoryId == c.Id).Count,
        }).ToList();
    }

    public async Task<List<CatalogSubCategoryLookupDto>> GetSubCategoriesAsync(CancellationToken ct = default)
    {
        var visibility = await CatalogVisibility.LoadAsync(statuses, ct);
        return await visibility.Visible(db.SubCategories.AsNoTracking())
            .OrderBy(s => s.Category.DisplayOrder).ThenBy(s => s.Category.Name).ThenBy(s => s.DisplayOrder).ThenBy(s => s.Name)
            .Select(s => new CatalogSubCategoryLookupDto
            {
                Id = s.Id,
                Name = s.Name,
                Code = s.Code,
                CategoryId = s.CategoryId,
                CategoryName = s.Category.Name,
                CategoryCode = s.Category.Code,
            })
            .ToListAsync(ct);
    }

    public async Task<List<CatalogProductLookupDto>> GetProductsAsync(Guid categoryId, CancellationToken ct = default)
    {
        var visibility = await CatalogVisibility.LoadAsync(statuses, ct);
        return await Project(visibility.Visible(db.Products.AsNoTracking()).Where(p => p.SubCategory.CategoryId == categoryId))
            .OrderBy(p => p.SubCategoryName).ThenBy(p => p.Name)
            .ToListAsync(ct);
    }

    public async Task<CatalogProductLookupDto?> GetProductAsync(Guid productId, CancellationToken ct = default)
    {
        var visibility = await CatalogVisibility.LoadAsync(statuses, ct);
        return await Project(visibility.Visible(db.Products.AsNoTracking()).Where(p => p.Id == productId))
            .FirstOrDefaultAsync(ct);
    }

    private static IQueryable<CatalogProductLookupDto> Project(IQueryable<Domain.Entities.Product> products) =>
        products.Select(p => new CatalogProductLookupDto
        {
            Id = p.Id,
            Name = p.Name,
            Code = p.Code,
            ShortDescription = p.ShortDescription,
            IconKey = p.IconKey,
            SubCategoryId = p.SubCategoryId,
            SubCategoryName = p.SubCategory.Name,
            SubCategoryCode = p.SubCategory.Code,
            CategoryId = p.SubCategory.CategoryId,
            CategoryName = p.SubCategory.Category.Name,
            CategoryCode = p.SubCategory.Category.Code,
        });
}
