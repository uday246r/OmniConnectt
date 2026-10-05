using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Application.Common;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;
using ProductMarketplace.Domain.Entities;
using ProductMarketplace.Infrastructure.Data;

namespace ProductMarketplace.Infrastructure.Services;

public class CategoryService : ICategoryService
{
    private readonly AppDbContext _db;
    private readonly IAuditLogService _audit;
    private readonly ICatalogStatuses _statuses;

    public CategoryService(AppDbContext db, IAuditLogService audit, ICatalogStatuses statuses)
    {
        _db = db;
        _audit = audit;
        _statuses = statuses;
    }

    public async Task<PagedResult<CategoryDto>> SearchAsync(CategoryQueryDto query, CancellationToken ct = default)
    {
        var q = _db.Categories.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(query.Status))
            q = q.Where(c => c.Status == query.Status);

        var term = query.Search?.Trim().ToLower();
        if (!string.IsNullOrWhiteSpace(term))
            q = q.Where(c => c.Name.ToLower().Contains(term) || c.Code.ToLower().Contains(term) || c.Description.ToLower().Contains(term));

        var total = await q.CountAsync(ct);

        // A stable tiebreaker last, so a category never appears on two pages or on none.
        IOrderedQueryable<Category> ordered = query.Sort.ToLowerInvariant() switch
        {
            "name" => q.OrderBy(c => c.Name),
            "-name" => q.OrderByDescending(c => c.Name),
            "created" => q.OrderBy(c => c.CreatedAt),
            "-created" => q.OrderByDescending(c => c.CreatedAt),
            "products" => q.OrderBy(c => c.SubCategories.SelectMany(s => s.Products).Count()),
            "-products" => q.OrderByDescending(c => c.SubCategories.SelectMany(s => s.Products).Count()),
            _ => q.OrderBy(c => c.DisplayOrder).ThenBy(c => c.CreatedAt),
        };

        var page = await ordered.ThenBy(c => c.Id)
            .Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            .ToListAsync(ct);

        var items = await DescribeAsync(page, ct);
        return new PagedResult<CategoryDto> { Items = items, Page = query.Page, PageSize = query.PageSize, TotalCount = total };
    }

    public async Task<CategoryDto?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        var category = await _db.Categories.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id, ct);
        return category is null ? null : (await DescribeAsync([category], ct))[0];
    }

    public async Task<CategoryDto> CreateAsync(CategoryCreateUpdateDto dto, CancellationToken ct = default)
    {
        var status = await StatusValidation.EnsureValidOrDefaultAsync(_db, StatusEntityTypes.Category, dto.Status, ct);
        var name = dto.Name.Trim();
        var code = CatalogCodes.Normalise(dto.Code);
        await EnsureUniqueAsync(name, code, excludingId: null, ct);

        var category = new Category
        {
            Name = name,
            Code = code,
            Description = dto.Description.Trim(),
            IconKey = dto.IconKey.Trim(),
            Status = status,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        var others = await _db.Categories.OrderBy(c => c.DisplayOrder).ThenBy(c => c.CreatedAt).ToListAsync(ct);
        _db.Categories.Add(category);
        DisplayOrdering.Place(others, category, dto.DisplayOrder > 0 ? dto.DisplayOrder : others.Count + 1, (c, n) => c.DisplayOrder = n);

        await _db.SaveOrReportDuplicateAsync($"A category with the name \"{name}\" or the code \"{code}\" already exists.", ct);
        await _audit.LogAsync(AuditActions.CreateCategory, AuditEntityTypes.Category, category.Id, category.Name, $"Created category \"{category.Name}\"", ct: ct);
        return (await GetByIdAsync(category.Id, ct))!;
    }

    public async Task<CategoryDto?> UpdateAsync(Guid id, CategoryCreateUpdateDto dto, CancellationToken ct = default)
    {
        var category = await _db.Categories.FirstOrDefaultAsync(c => c.Id == id, ct);
        if (category is null) return null;

        var status = await StatusValidation.EnsureValidOrDefaultAsync(_db, StatusEntityTypes.Category, dto.Status, ct);
        var name = dto.Name.Trim();
        var code = CatalogCodes.Normalise(dto.Code);
        await EnsureUniqueAsync(name, code, excludingId: id, ct);

        category.Name = name;
        category.Code = code;
        category.Description = dto.Description.Trim();
        category.IconKey = dto.IconKey.Trim();
        category.Status = status;
        category.UpdatedAt = DateTime.UtcNow;

        if (dto.DisplayOrder > 0 && dto.DisplayOrder != category.DisplayOrder)
        {
            var others = await _db.Categories.Where(c => c.Id != id).OrderBy(c => c.DisplayOrder).ThenBy(c => c.CreatedAt).ToListAsync(ct);
            DisplayOrdering.Place(others, category, dto.DisplayOrder, (c, n) => c.DisplayOrder = n);
        }

        await _db.SaveOrReportDuplicateAsync($"A category with the name \"{name}\" or the code \"{code}\" already exists.", ct);
        await _audit.LogAsync(AuditActions.UpdateCategory, AuditEntityTypes.Category, category.Id, category.Name, $"Updated category \"{category.Name}\"", ct: ct);
        return await GetByIdAsync(id, ct);
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var category = await _db.Categories.FirstOrDefaultAsync(c => c.Id == id, ct);
        if (category is null) return false;

        if (await _db.SubCategories.AnyAsync(s => s.CategoryId == id, ct))
            throw new InvalidOperationException("Cannot delete a category that still has sub-categories. Remove or move them first, or mark the category inactive to hide it.");

        _db.Categories.Remove(category);
        await _db.SaveChangesAsync(ct);

        var remaining = await _db.Categories.OrderBy(c => c.DisplayOrder).ThenBy(c => c.CreatedAt).ToListAsync(ct);
        DisplayOrdering.Renumber(remaining, (c, n) => c.DisplayOrder = n);
        await _db.SaveChangesAsync(ct);

        await _audit.LogAsync(AuditActions.DeleteCategory, AuditEntityTypes.Category, id, category.Name, $"Deleted category \"{category.Name}\"", ct: ct);
        return true;
    }

    public async Task<CategoryDto?> ReorderAsync(Guid id, string direction, CancellationToken ct = default)
    {
        var siblings = await _db.Categories.OrderBy(c => c.DisplayOrder).ThenBy(c => c.CreatedAt).ToListAsync(ct);
        var index = siblings.FindIndex(c => c.Id == id);
        if (index < 0) return null;

        var swapIndex = direction.Equals("up", StringComparison.OrdinalIgnoreCase) ? index - 1 : index + 1;
        if (swapIndex >= 0 && swapIndex < siblings.Count)
        {
            (siblings[index], siblings[swapIndex]) = (siblings[swapIndex], siblings[index]);
            DisplayOrdering.Renumber(siblings, (c, n) => c.DisplayOrder = n);
            await _db.SaveChangesAsync(ct);

            var moved = siblings[swapIndex];
            await _audit.LogAsync(AuditActions.ReorderCategory, AuditEntityTypes.Category, moved.Id, moved.Name, $"Reordered category \"{moved.Name}\" ({direction})", ct: ct);
        }

        return await GetByIdAsync(id, ct);
    }

    private async Task EnsureUniqueAsync(string name, string code, Guid? excludingId, CancellationToken ct)
    {
        var lowerName = name.ToLower();
        if (await _db.Categories.AnyAsync(c => c.Id != excludingId && c.Name.ToLower() == lowerName, ct))
            throw new InvalidOperationException($"A category named \"{name}\" already exists.");
        if (await _db.Categories.AnyAsync(c => c.Id != excludingId && c.Code == code, ct))
            throw new InvalidOperationException($"The code \"{code}\" is already used by another category.");
    }

    /// <summary>
    /// Fills in each category's counts with two grouped queries over just these ids, rather than loading
    /// every product or sub-category to count them.
    /// </summary>
    private async Task<List<CategoryDto>> DescribeAsync(IReadOnlyList<Category> categories, CancellationToken ct)
    {
        if (categories.Count == 0) return [];

        var ids = categories.Select(c => c.Id).ToList();
        var subCounts = await _db.SubCategories.AsNoTracking()
            .Where(s => ids.Contains(s.CategoryId))
            .GroupBy(s => s.CategoryId)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        var productCounts = await _db.Products.AsNoTracking()
            .Where(p => ids.Contains(p.SubCategory.CategoryId))
            .GroupBy(p => p.SubCategory.CategoryId)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        var live = await _statuses.LiveValuesAsync(StatusEntityTypes.Category, ct);

        return categories
            .Select(c => c.ToDto(live.Contains(c.Status), subCounts.GetValueOrDefault(c.Id), productCounts.GetValueOrDefault(c.Id)))
            .ToList();
    }
}
