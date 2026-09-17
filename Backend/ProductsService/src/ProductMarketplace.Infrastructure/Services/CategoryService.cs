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
    public CategoryService(AppDbContext db, IAuditLogService audit)
    {
        _db = db;
        _audit = audit;
    }

    private IQueryable<Category> Base() => _db.Categories
        .Include(c => c.Products)
        .Include(c => c.SubCategories);

    public async Task<List<CategoryDto>> GetAllAsync(string? status, CancellationToken ct = default)
    {
        // No Include of products: counts come from one grouped query, instead of loading every product
        // row in the catalogue just to count how many belong to each category.
        var query = _db.Categories.AsNoTracking().Where(c => c.ParentCategoryId == null);
        if (!string.IsNullOrWhiteSpace(status))
            query = query.Where(c => c.Status == status);

        var categories = await query.OrderBy(c => c.DisplayOrder).ThenBy(c => c.CreatedAt).ToListAsync(ct);

        /*
         * Repair display order only when it actually has a gap.
         *
         * Every read used to load and track the whole category table first, just to renumber it — an
         * extra round trip (and sometimes a write) on each visit to the page, although every write path
         * (create, update, reorder, delete) already keeps each sibling set numbered 1..N. The top-level
         * rows this read just loaded show whether that still holds; only legacy data needs the repair.
         */
        var unfiltered = string.IsNullOrWhiteSpace(status);
        if (unfiltered && categories.Where((c, i) => c.DisplayOrder != i + 1).Any())
        {
            await SanitizeDisplayOrdersAsync(ct);
            categories = await query.OrderBy(c => c.DisplayOrder).ThenBy(c => c.CreatedAt).ToListAsync(ct);
        }
        var rollup = await BuildProductRollupAsync(ct);

        return categories.Select(c => rollup.Describe(c)).ToList();
    }

    public async Task<CategoryDto?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        var c = await _db.Categories.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id, ct);
        if (c is null) return null;

        return (await BuildProductRollupAsync(ct)).Describe(c);
    }

    public async Task<CategoryDto> CreateAsync(CategoryCreateUpdateDto dto, CancellationToken ct = default)
    {
        var status = await StatusValidation.EnsureValidOrDefaultAsync(_db, StatusEntityTypes.Category, dto.Status, ct);
        var slug = Slugify(dto.Name);

        if (await _db.Categories.AnyAsync(c => c.Slug == slug, ct))
            throw new InvalidOperationException($"A category named \"{dto.Name}\" already exists.");

        var count = await _db.Categories.CountAsync(c => c.ParentCategoryId == null, ct);
        var targetOrder = dto.DisplayOrder > 0 ? dto.DisplayOrder : count + 1;

        var category = new Category
        {
            Name = dto.Name,
            Slug = slug,
            Description = dto.Description,
            IconKey = dto.IconKey,
            Status = status,
            DisplayOrder = targetOrder,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        _db.Categories.Add(category);
        await ReorderSiblingsAsync(category, targetOrder, ct);
        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(AuditActions.CreateCategory, AuditEntityTypes.Category, category.Id, category.Name, $"Created category \"{category.Name}\"", ct: ct);
        return category.ToDto();
    }

    public async Task<CategoryDto?> UpdateAsync(Guid id, CategoryCreateUpdateDto dto, CancellationToken ct = default)
    {
        var category = await Base().FirstOrDefaultAsync(c => c.Id == id, ct);
        if (category is null) return null;

        var status = await StatusValidation.EnsureValidOrDefaultAsync(_db, StatusEntityTypes.Category, dto.Status, ct);
        var slug = Slugify(dto.Name);

        if (await _db.Categories.AnyAsync(c => c.Slug == slug && c.Id != id, ct))
            throw new InvalidOperationException($"A category named \"{dto.Name}\" already exists.");

        category.Name = dto.Name;
        category.Slug = slug;
        category.Description = dto.Description;
        category.IconKey = dto.IconKey;
        category.Status = status;
        category.UpdatedAt = DateTime.UtcNow;

        if (dto.DisplayOrder > 0)
        {
            await ReorderSiblingsAsync(category, dto.DisplayOrder, ct);
        }

        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(AuditActions.UpdateCategory, AuditEntityTypes.Category, category.Id, category.Name, $"Updated category \"{category.Name}\"", ct: ct);
        return await ToDtoWithRollupAsync(category, ct);
    }

    /// <summary>
    /// Moves a category to <paramref name="newOrder"/> among its siblings (same ParentCategoryId)
    /// and renumbers the rest sequentially (1..N) so DisplayOrder values stay unique and contiguous.
    /// </summary>
    private async Task ReorderSiblingsAsync(Category category, int newOrder, CancellationToken ct)
    {
        var siblings = await _db.Categories
            .Where(c => c.ParentCategoryId == category.ParentCategoryId && c.Id != category.Id)
            .OrderBy(c => c.DisplayOrder)
            .ThenBy(c => c.CreatedAt)
            .ToListAsync(ct);

        var clampedIndex = Math.Clamp(newOrder - 1, 0, siblings.Count);
        siblings.Insert(clampedIndex, category);

        for (var i = 0; i < siblings.Count; i++)
            siblings[i].DisplayOrder = i + 1;
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var category = await _db.Categories
            .Include(c => c.Products)
            .Include(c => c.SubCategories)
            .FirstOrDefaultAsync(c => c.Id == id, ct);
        if (category is null) return false;
        if (category.Products.Count > 0) throw new InvalidOperationException("Cannot delete a category that has products assigned to it.");
        if (category.SubCategories.Count > 0)
            throw new InvalidOperationException("Cannot delete a category that still has sub-categories. Remove or reassign them first.");

        var parentId = category.ParentCategoryId;
        _db.Categories.Remove(category);
        await _db.SaveChangesAsync(ct);

        await RenumberAsync(parentId, ct);
        await _audit.LogAsync(AuditActions.DeleteCategory, AuditEntityTypes.Category, id, category.Name, $"Deleted category \"{category.Name}\"", ct: ct);
        return true;
    }

    public async Task<CategoryDto?> ReorderAsync(Guid id, string direction, CancellationToken ct = default)
    {
        var category = await Base().FirstOrDefaultAsync(c => c.Id == id, ct);
        if (category is null) return null;

        var siblings = await Base()
            .Where(c => c.ParentCategoryId == category.ParentCategoryId)
            .OrderBy(c => c.DisplayOrder).ThenBy(c => c.CreatedAt).ToListAsync(ct);

        var index = siblings.FindIndex(c => c.Id == id);
        var swapIndex = direction.Equals("up", StringComparison.OrdinalIgnoreCase) ? index - 1 : index + 1;
        if (swapIndex < 0 || swapIndex >= siblings.Count) return await ToDtoWithRollupAsync(category, ct);

        (siblings[index], siblings[swapIndex]) = (siblings[swapIndex], siblings[index]);
        for (var i = 0; i < siblings.Count; i++)
            siblings[i].DisplayOrder = i + 1;

        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(AuditActions.ReorderCategory, AuditEntityTypes.Category, category.Id, category.Name, $"Reordered category \"{category.Name}\" ({direction})", ct: ct);
        return await ToDtoWithRollupAsync(category, ct);
    }

    /// <summary>Renumbers one sibling set to a contiguous 1..N so no gaps or duplicates remain.</summary>
    private async Task RenumberAsync(Guid? parentCategoryId, CancellationToken ct)
    {
        var siblings = await _db.Categories
            .Where(c => c.ParentCategoryId == parentCategoryId)
            .OrderBy(c => c.DisplayOrder)
            .ThenBy(c => c.CreatedAt)
            .ToListAsync(ct);

        var changed = false;
        for (var i = 0; i < siblings.Count; i++)
        {
            if (siblings[i].DisplayOrder == i + 1) continue;
            siblings[i].DisplayOrder = i + 1;
            changed = true;
        }

        if (changed) await _db.SaveChangesAsync(ct);
    }

    private async Task SanitizeDisplayOrdersAsync(CancellationToken ct)
    {
        var allCategories = await _db.Categories.ToListAsync(ct);
        var groups = allCategories.GroupBy(c => c.ParentCategoryId);
        var changed = false;

        foreach (var group in groups)
        {
            var ordered = group.OrderBy(c => c.DisplayOrder).ThenBy(c => c.CreatedAt).ToList();
            for (int i = 0; i < ordered.Count; i++)
            {
                if (ordered[i].DisplayOrder != i + 1)
                {
                    ordered[i].DisplayOrder = i + 1;
                    changed = true;
                }
            }
        }

        if (changed)
        {
            await _db.SaveChangesAsync(ct);
        }
    }

    private async Task<CategoryDto> ToDtoWithRollupAsync(Category category, CancellationToken ct)
    {
        return (await BuildProductRollupAsync(ct)).Describe(category);
    }

    /// <summary>
    /// Builds the category tree plus a direct product count per category in two queries, so a
    /// category's "linked products" total can include everything filed under its descendants rather
    /// than only the products attached to it directly.
    /// </summary>
    private async Task<ProductRollup> BuildProductRollupAsync(CancellationToken ct)
    {
        var nodes = await _db.Categories.AsNoTracking()
            .Select(c => new { c.Id, c.ParentCategoryId })
            .ToListAsync(ct);

        var directCounts = await _db.Products.AsNoTracking()
            .GroupBy(p => p.CategoryId)
            .Select(g => new { CategoryId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.CategoryId, x => x.Count, ct);

        var childrenByParent = nodes
            .Where(n => n.ParentCategoryId.HasValue)
            .GroupBy(n => n.ParentCategoryId!.Value)
            .ToDictionary(g => g.Key, g => g.Select(n => n.Id).ToList());

        return new ProductRollup(directCounts, childrenByParent);
    }

    private sealed class ProductRollup
    {
        private readonly Dictionary<Guid, int> _directCounts;
        private readonly Dictionary<Guid, List<Guid>> _childrenByParent;

        public ProductRollup(Dictionary<Guid, int> directCounts, Dictionary<Guid, List<Guid>> childrenByParent)
        {
            _directCounts = directCounts;
            _childrenByParent = childrenByParent;
        }

        /// <summary>The category's DTO with its product and sub-category counts filled from the rollup.</summary>
        public CategoryDto Describe(Category category)
        {
            var dto = category.ToDto();
            dto.ProductCount = _directCounts.TryGetValue(category.Id, out var direct) ? direct : 0;
            dto.SubCategoryCount = _childrenByParent.TryGetValue(category.Id, out var children) ? children.Count : 0;
            dto.TotalProductCount = TotalFor(category.Id);
            return dto;
        }

        public int TotalFor(Guid categoryId)
        {
            var total = 0;
            var visited = new HashSet<Guid>();
            var stack = new Stack<Guid>();
            stack.Push(categoryId);

            while (stack.Count > 0)
            {
                var current = stack.Pop();
                // Guards against a malformed parent chain looping forever.
                if (!visited.Add(current)) continue;

                total += _directCounts.TryGetValue(current, out var count) ? count : 0;
                if (!_childrenByParent.TryGetValue(current, out var children)) continue;
                foreach (var child in children) stack.Push(child);
            }

            return total;
        }
    }

    private static string Slugify(string name) => name.Trim().ToLowerInvariant().Replace(" ", "-").Replace("&", "and");
}
