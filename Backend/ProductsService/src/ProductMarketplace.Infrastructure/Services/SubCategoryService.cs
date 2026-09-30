using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Application.Common;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;
using ProductMarketplace.Domain.Entities;
using ProductMarketplace.Domain.Enums;
using ProductMarketplace.Infrastructure.Data;

namespace ProductMarketplace.Infrastructure.Services;

public class SubCategoryService : ISubCategoryService
{
    private readonly AppDbContext _db;
    private readonly IAuditLogService _audit;
    private readonly ICatalogStatuses _statuses;

    public SubCategoryService(AppDbContext db, IAuditLogService audit, ICatalogStatuses statuses)
    {
        _db = db;
        _audit = audit;
        _statuses = statuses;
    }

    public async Task<PagedResult<SubCategoryDto>> SearchAsync(SubCategoryQueryDto query, CancellationToken ct = default)
    {
        var q = _db.SubCategories.AsNoTracking().AsQueryable();

        if (query.CategoryId.HasValue) q = q.Where(s => s.CategoryId == query.CategoryId);
        if (!string.IsNullOrWhiteSpace(query.Status)) q = q.Where(s => s.Status == query.Status);

        var term = query.Search?.Trim().ToLower();
        if (!string.IsNullOrWhiteSpace(term))
            q = q.Where(s => s.Name.ToLower().Contains(term) || s.Code.ToLower().Contains(term) || s.Description.ToLower().Contains(term) || s.Category.Name.ToLower().Contains(term));

        var total = await q.CountAsync(ct);

        IOrderedQueryable<SubCategory> ordered = query.Sort.ToLowerInvariant() switch
        {
            "name" => q.OrderBy(s => s.Name),
            "-name" => q.OrderByDescending(s => s.Name),
            "created" => q.OrderBy(s => s.CreatedAt),
            "-created" => q.OrderByDescending(s => s.CreatedAt),
            "products" => q.OrderBy(s => s.Products.Count),
            "-products" => q.OrderByDescending(s => s.Products.Count),
            // Grouped by category in the categories' own order, then in each category's own order.
            _ => q.OrderBy(s => s.Category.DisplayOrder).ThenBy(s => s.DisplayOrder),
        };

        var page = await ordered.ThenBy(s => s.Id)
            .Include(s => s.Category)
            .Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            .ToListAsync(ct);

        var counts = await ProductCountsAsync(page.Select(s => s.Id).ToList(), ct);
        var live = await _statuses.LiveValuesAsync(StatusEntityTypes.SubCategory, ct);
        var items = page.Select(s => s.ToDto(live.Contains(s.Status), counts.GetValueOrDefault(s.Id))).ToList();

        return new PagedResult<SubCategoryDto> { Items = items, Page = query.Page, PageSize = query.PageSize, TotalCount = total };
    }

    public async Task<SubCategoryDetailDto?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        var sub = await _db.SubCategories.AsNoTracking()
            .Include(s => s.Category)
            .Include(s => s.FieldDefinitions)
            .FirstOrDefaultAsync(s => s.Id == id, ct);
        if (sub is null) return null;

        var counts = await ProductCountsAsync([id], ct);
        var live = await _statuses.LiveValuesAsync(StatusEntityTypes.SubCategory, ct);
        return sub.ToDetailDto(live.Contains(sub.Status), counts.GetValueOrDefault(id));
    }

    public async Task<SubCategoryDetailDto> CreateAsync(SubCategoryCreateUpdateDto dto, CancellationToken ct = default)
    {
        var category = await _db.Categories.FirstOrDefaultAsync(c => c.Id == dto.CategoryId, ct)
            ?? throw new InvalidOperationException("Choose an existing category for this sub-category.");
        var status = await StatusValidation.EnsureValidOrDefaultAsync(_db, StatusEntityTypes.SubCategory, dto.Status, ct);
        var name = dto.Name.Trim();
        var code = CatalogCodes.Normalise(dto.Code);
        await EnsureUniqueAsync(category.Id, name, code, excludingId: null, ct);

        var sub = new SubCategory
        {
            CategoryId = category.Id,
            Name = name,
            Code = code,
            Description = dto.Description.Trim(),
            IconKey = dto.IconKey.Trim(),
            Status = status,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        var siblings = await SiblingsAsync(category.Id, excluding: null, ct);
        _db.SubCategories.Add(sub);
        DisplayOrdering.Place(siblings, sub, dto.DisplayOrder > 0 ? dto.DisplayOrder : siblings.Count + 1, (s, n) => s.DisplayOrder = n);

        await _db.SaveOrReportDuplicateAsync($"A sub-category named \"{name}\" already exists in {category.Name}, or the code \"{code}\" is already in use.", ct);
        await _audit.LogAsync(AuditActions.CreateSubCategory, AuditEntityTypes.SubCategory, sub.Id, sub.Name, $"Created sub-category \"{sub.Name}\" under \"{category.Name}\"", ct: ct);
        return (await GetByIdAsync(sub.Id, ct))!;
    }

    public async Task<SubCategoryDetailDto?> UpdateAsync(Guid id, SubCategoryCreateUpdateDto dto, CancellationToken ct = default)
    {
        var sub = await _db.SubCategories.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (sub is null) return null;

        var category = await _db.Categories.FirstOrDefaultAsync(c => c.Id == dto.CategoryId, ct)
            ?? throw new InvalidOperationException("Choose an existing category for this sub-category.");
        var status = await StatusValidation.EnsureValidOrDefaultAsync(_db, StatusEntityTypes.SubCategory, dto.Status, ct);
        var name = dto.Name.Trim();
        var code = CatalogCodes.Normalise(dto.Code);
        await EnsureUniqueAsync(category.Id, name, code, excludingId: id, ct);

        var previousCategoryId = sub.CategoryId;
        sub.CategoryId = category.Id;
        sub.Name = name;
        sub.Code = code;
        sub.Description = dto.Description.Trim();
        sub.IconKey = dto.IconKey.Trim();
        sub.Status = status;
        sub.UpdatedAt = DateTime.UtcNow;

        if (previousCategoryId != category.Id)
        {
            // Moved to another category: every product beneath it moves too (a product reaches its
            // category through this record), joins the end of the new category's order unless told
            // otherwise, and leaves the old one without a gap.
            var newSiblings = await SiblingsAsync(category.Id, excluding: id, ct);
            DisplayOrdering.Place(newSiblings, sub, dto.DisplayOrder > 0 ? dto.DisplayOrder : newSiblings.Count + 1, (s, n) => s.DisplayOrder = n);
            DisplayOrdering.Renumber(await SiblingsAsync(previousCategoryId, excluding: id, ct), (s, n) => s.DisplayOrder = n);
        }
        else if (dto.DisplayOrder > 0 && dto.DisplayOrder != sub.DisplayOrder)
        {
            DisplayOrdering.Place(await SiblingsAsync(category.Id, excluding: id, ct), sub, dto.DisplayOrder, (s, n) => s.DisplayOrder = n);
        }

        await _db.SaveOrReportDuplicateAsync($"A sub-category named \"{name}\" already exists in {category.Name}, or the code \"{code}\" is already in use.", ct);
        await _audit.LogAsync(AuditActions.UpdateSubCategory, AuditEntityTypes.SubCategory, sub.Id, sub.Name, $"Updated sub-category \"{sub.Name}\"", ct: ct);
        return await GetByIdAsync(id, ct);
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var sub = await _db.SubCategories.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (sub is null) return false;

        if (await _db.Products.AnyAsync(p => p.SubCategoryId == id, ct))
            throw new InvalidOperationException("Cannot delete a sub-category that still has products. Move or remove them first, or mark the sub-category inactive to hide it.");

        _db.SubCategories.Remove(sub);
        await _db.SaveChangesAsync(ct);

        DisplayOrdering.Renumber(await SiblingsAsync(sub.CategoryId, excluding: null, ct), (s, n) => s.DisplayOrder = n);
        await _db.SaveChangesAsync(ct);

        await _audit.LogAsync(AuditActions.DeleteSubCategory, AuditEntityTypes.SubCategory, id, sub.Name, $"Deleted sub-category \"{sub.Name}\"", ct: ct);
        return true;
    }

    public async Task<SubCategoryDetailDto?> ReorderAsync(Guid id, string direction, CancellationToken ct = default)
    {
        var sub = await _db.SubCategories.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id, ct);
        if (sub is null) return null;

        var siblings = await SiblingsAsync(sub.CategoryId, excluding: null, ct);
        var index = siblings.FindIndex(s => s.Id == id);
        var swapIndex = direction.Equals("up", StringComparison.OrdinalIgnoreCase) ? index - 1 : index + 1;
        if (swapIndex >= 0 && swapIndex < siblings.Count)
        {
            (siblings[index], siblings[swapIndex]) = (siblings[swapIndex], siblings[index]);
            DisplayOrdering.Renumber(siblings, (s, n) => s.DisplayOrder = n);
            await _db.SaveChangesAsync(ct);
            await _audit.LogAsync(AuditActions.ReorderSubCategory, AuditEntityTypes.SubCategory, sub.Id, sub.Name, $"Reordered sub-category \"{sub.Name}\" ({direction})", ct: ct);
        }

        return await GetByIdAsync(id, ct);
    }

    // ---- Fields: the attributes every product of this sub-category carries -------------------------

    public async Task<SubCategoryDetailDto?> CreateFieldAsync(Guid subCategoryId, FieldDefinitionCreateUpdateDto dto, CancellationToken ct = default)
    {
        var sub = await _db.SubCategories.Include(s => s.FieldDefinitions).FirstOrDefaultAsync(s => s.Id == subCategoryId, ct);
        if (sub is null) return null;

        var key = FieldKey(dto);
        if (sub.FieldDefinitions.Any(f => f.Key == key))
            throw new InvalidOperationException($"A field with key \"{key}\" already exists on \"{sub.Name}\".");

        var field = new FieldDefinition { SubCategoryId = subCategoryId };
        Apply(field, dto, key, sub, fieldBeingEdited: null);
        field.SortOrder = dto.SortOrder > 0 ? dto.SortOrder : sub.FieldDefinitions.Count + 1;

        _db.FieldDefinitions.Add(field);
        await _db.SaveOrReportDuplicateAsync($"A field with key \"{key}\" already exists on \"{sub.Name}\".", ct);
        await _audit.LogAsync(AuditActions.CreateField, AuditEntityTypes.FieldDefinition, field.Id, field.Label, $"Added field \"{field.Label}\" to sub-category \"{sub.Name}\"", ct: ct);
        return await GetByIdAsync(subCategoryId, ct);
    }

    public async Task<SubCategoryDetailDto?> UpdateFieldAsync(Guid subCategoryId, Guid fieldId, FieldDefinitionCreateUpdateDto dto, CancellationToken ct = default)
    {
        var sub = await _db.SubCategories.Include(s => s.FieldDefinitions).FirstOrDefaultAsync(s => s.Id == subCategoryId, ct);
        var field = sub?.FieldDefinitions.FirstOrDefault(f => f.Id == fieldId);
        if (sub is null || field is null) return null;

        var key = FieldKey(dto);
        if (sub.FieldDefinitions.Any(f => f.Key == key && f.Id != fieldId))
            throw new InvalidOperationException($"A field with key \"{key}\" already exists on \"{sub.Name}\".");

        // Products already hold values keyed by this field; changing its type underneath them would leave
        // stored values that no longer mean what the definition says.
        var newType = ParseDataType(dto.DataType);
        if (newType != field.DataType && await _db.ProductFieldValues.AnyAsync(v => v.FieldDefinitionId == fieldId, ct))
            throw new InvalidOperationException($"Cannot change the type of \"{field.Label}\" while products hold values for it. Add a new field instead.");

        Apply(field, dto, key, sub, fieldBeingEdited: field);
        field.SortOrder = dto.SortOrder;

        await _db.SaveOrReportDuplicateAsync($"A field with key \"{key}\" already exists on \"{sub.Name}\".", ct);
        await _audit.LogAsync(AuditActions.UpdateField, AuditEntityTypes.FieldDefinition, field.Id, field.Label, $"Updated field \"{field.Label}\" on sub-category \"{sub.Name}\"", ct: ct);
        return await GetByIdAsync(subCategoryId, ct);
    }

    public async Task<SubCategoryDetailDto?> DeleteFieldAsync(Guid subCategoryId, Guid fieldId, CancellationToken ct = default)
    {
        var sub = await _db.SubCategories.Include(s => s.FieldDefinitions).FirstOrDefaultAsync(s => s.Id == subCategoryId, ct);
        var field = sub?.FieldDefinitions.FirstOrDefault(f => f.Id == fieldId);
        if (sub is null || field is null) return null;

        if (await _db.ProductFieldValues.AnyAsync(v => v.FieldDefinitionId == fieldId, ct))
            throw new InvalidOperationException($"Cannot delete field \"{field.Label}\" - it is currently set on one or more products. Remove it from those products first.");

        _db.FieldDefinitions.Remove(field);
        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(AuditActions.DeleteField, AuditEntityTypes.FieldDefinition, fieldId, field.Label, $"Removed field \"{field.Label}\" from sub-category \"{sub.Name}\"", ct: ct);
        return await GetByIdAsync(subCategoryId, ct);
    }

    // ---- Helpers ---------------------------------------------------------------------------------

    private static string FieldKey(FieldDefinitionCreateUpdateDto dto)
    {
        var key = CatalogText.ToKey(string.IsNullOrWhiteSpace(dto.Key) ? dto.Label : dto.Key);
        if (key.Length == 0) throw new InvalidOperationException("A field needs a label (or a key) made of letters or numbers.");
        return key;
    }

    private static FieldDataType ParseDataType(string value) =>
        Enum.TryParse<FieldDataType>(value, ignoreCase: true, out var type) && Enum.IsDefined(type)
            ? type
            : throw new InvalidOperationException($"'{value}' is not a field type. Choose one of: {string.Join(", ", Enum.GetNames<FieldDataType>())}.");

    private static void Apply(FieldDefinition field, FieldDefinitionCreateUpdateDto dto, string key, SubCategory sub, FieldDefinition? fieldBeingEdited)
    {
        if (string.IsNullOrWhiteSpace(dto.Label)) throw new InvalidOperationException("A field needs a label.");

        var type = ParseDataType(dto.DataType);
        var options = dto.Options?.Select(o => o.Trim()).Where(o => o.Length > 0).Distinct().ToList();
        if (type is FieldDataType.Dropdown or FieldDataType.MultiSelect && options is not { Count: > 0 })
            throw new InvalidOperationException($"\"{dto.Label}\" is a {type} field, so it needs at least one option to choose from.");

        if (type == FieldDataType.MultiSelect && options!.Any(o => o.Contains(',')))
            throw new InvalidOperationException($"An option for \"{dto.Label}\" contains a comma. Multiple choices are stored comma-separated, so options cannot contain one.");

        if (dto.IsPrimaryMetric && sub.FieldDefinitions.Any(f => f.IsPrimaryMetric && f != fieldBeingEdited))
            throw new InvalidOperationException("Only one field per sub-category can be the primary metric — the one products are sorted by. Clear it on the other field first.");

        FieldRuleJson.EnsureUsable(dto.Validations, dto.Label);

        field.Key = key;
        field.Label = dto.Label.Trim();
        field.DataType = type;
        field.Unit = string.IsNullOrWhiteSpace(dto.Unit) ? null : dto.Unit;
        field.OptionsJson = options is { Count: > 0 } ? JsonSerializer.Serialize(options) : null;
        field.ValidationsJson = FieldRuleJson.Serialize(dto.Validations);
        field.Required = dto.Required;
        field.Filterable = dto.Filterable;
        field.Sortable = dto.Sortable;
        field.DisplayOnCard = dto.DisplayOnCard;
        field.DisplayOnDetails = dto.DisplayOnDetails;
        field.IsReadOnly = dto.IsReadOnly;
        field.IsPrimaryMetric = dto.IsPrimaryMetric;
        field.IsSecondaryMetric = dto.IsSecondaryMetric;
    }

    private async Task EnsureUniqueAsync(Guid categoryId, string name, string code, Guid? excludingId, CancellationToken ct)
    {
        var lowerName = name.ToLower();
        if (await _db.SubCategories.AnyAsync(s => s.Id != excludingId && s.CategoryId == categoryId && s.Name.ToLower() == lowerName, ct))
            throw new InvalidOperationException($"This category already has a sub-category named \"{name}\".");
        if (await _db.SubCategories.AnyAsync(s => s.Id != excludingId && s.Code == code, ct))
            throw new InvalidOperationException($"The code \"{code}\" is already used by another sub-category.");
    }

    private Task<List<SubCategory>> SiblingsAsync(Guid categoryId, Guid? excluding, CancellationToken ct) =>
        _db.SubCategories
            .Where(s => s.CategoryId == categoryId && s.Id != excluding)
            .OrderBy(s => s.DisplayOrder).ThenBy(s => s.CreatedAt)
            .ToListAsync(ct);

    private async Task<Dictionary<Guid, int>> ProductCountsAsync(List<Guid> subCategoryIds, CancellationToken ct) =>
        subCategoryIds.Count == 0
            ? []
            : await _db.Products.AsNoTracking()
                .Where(p => subCategoryIds.Contains(p.SubCategoryId))
                .GroupBy(p => p.SubCategoryId)
                .Select(g => new { g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.Key, x => x.Count, ct);
}
