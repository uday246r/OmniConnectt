using System.Globalization;
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
    private readonly ICatalogStatuses _statuses;
    private readonly IFormatPresetSource _presets;

    public ProductService(AppDbContext db, IAuditLogService audit, ICatalogStatuses statuses, IFormatPresetSource presets)
    {
        _db = db;
        _audit = audit;
        _statuses = statuses;
        _presets = presets;
    }

    private IQueryable<Product> FullGraph() => _db.Products
        .Include(p => p.SubCategory).ThenInclude(s => s.Category)
        .Include(p => p.FieldValues).ThenInclude(v => v.FieldDefinition)
        .Include(p => p.Benefits)
        .Include(p => p.EligibilityCriteria);

    /// <summary>The single definition of which products a catalogue query selects — shared by the page, the counts and the download.</summary>
    private async Task<IQueryable<Product>> FilteredAsync(ProductQueryDto query, bool includeStatus, CancellationToken ct)
    {
        var q = _db.Products.AsNoTracking().AsQueryable();

        if (query.SubCategoryId.HasValue) q = q.Where(p => p.SubCategoryId == query.SubCategoryId);
        if (query.CategoryId.HasValue) q = q.Where(p => p.SubCategory.CategoryId == query.CategoryId);
        if (includeStatus && !string.IsNullOrWhiteSpace(query.Status)) q = q.Where(p => p.Status == query.Status);
        if (query.VisibleOnly) q = (await CatalogVisibility.LoadAsync(_statuses, ct)).Visible(q);

        /*
         * Name, code, blurb and where it sits — not the long description, the benefits or every field value.
         *
         * A substring match over all of those has to read every row's text and every product's every
         * attribute, which no index can help, so the cost of a search grew with the whole catalogue. The
         * columns a person actually types a name or code from are enough, and stay cheap.
         */
        var term = query.Search?.Trim().ToLower();
        if (!string.IsNullOrWhiteSpace(term))
        {
            q = q.Where(p =>
                p.Name.ToLower().Contains(term) ||
                p.Code.ToLower().Contains(term) ||
                p.ShortDescription.ToLower().Contains(term) ||
                p.SubCategory.Name.ToLower().Contains(term) ||
                p.SubCategory.Category.Name.ToLower().Contains(term));
        }

        return q;
    }

    /// <summary>
    /// How many products hold each status under the catalogue's other filters (the status filter itself
    /// is ignored), in one grouped query.
    /// </summary>
    public async Task<IReadOnlyList<StatusCountDto>> StatusCountsAsync(ProductQueryDto query, CancellationToken ct = default)
    {
        var rows = await (await FilteredAsync(query, includeStatus: false, ct))
            .GroupBy(p => p.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync(ct);
        return rows.OrderBy(r => r.Status).Select(r => new StatusCountDto(r.Status, r.Count)).ToList();
    }

    private static IOrderedQueryable<Product> Sorted(IQueryable<Product> q, string sort)
    {
        IOrderedQueryable<Product> sorted = sort.ToLowerInvariant() switch
        {
            "oldest" => q.OrderBy(p => p.CreatedAt),
            "name" => q.OrderBy(p => p.Name),
            "-name" => q.OrderByDescending(p => p.Name),
            // Products with no primary metric sort last either way.
            "primary-metric" => q
                .OrderBy(p => p.FieldValues.Where(v => v.FieldDefinition.IsPrimaryMetric).Select(v => v.NumericValue).FirstOrDefault() == null)
                .ThenBy(p => p.FieldValues.Where(v => v.FieldDefinition.IsPrimaryMetric).Select(v => v.NumericValue).FirstOrDefault()),
            "-primary-metric" => q
                .OrderBy(p => p.FieldValues.Where(v => v.FieldDefinition.IsPrimaryMetric).Select(v => v.NumericValue).FirstOrDefault() == null)
                .ThenByDescending(p => p.FieldValues.Where(v => v.FieldDefinition.IsPrimaryMetric).Select(v => v.NumericValue).FirstOrDefault()),
            _ => q.OrderByDescending(p => p.CreatedAt),
        };

        // A stable tiebreaker, so a product never appears on two pages or on none.
        return sorted.ThenBy(p => p.Id);
    }

    /// <summary>The largest product download served in one file.</summary>
    public const int ExportRowLimit = 10_000;

    public async Task<CsvExport> ExportCsvAsync(ProductQueryDto query, CancellationToken ct = default)
    {
        var filtered = await FilteredAsync(query, includeStatus: true, ct);
        var matched = await filtered.CountAsync(ct);
        var rows = await Sorted(filtered, query.Sort)
            .Take(ExportRowLimit)
            .Select(p => new { p.Name, p.Code, Category = p.SubCategory.Category.Name, SubCategory = p.SubCategory.Name, p.Status, p.ViewCount, p.CreatedAt })
            .ToListAsync(ct);

        var csv = new CsvBuilder("Product", "Code", "Category", "Sub-category", "Status", "Views", "Added (UTC)");
        foreach (var r in rows)
        {
            csv.AppendRow(r.Name, r.Code, r.Category, r.SubCategory, r.Status, r.ViewCount.ToString(CultureInfo.InvariantCulture), r.CreatedAt.ToString("O"));
        }

        return new CsvExport(csv.ToString(), rows.Count, matched, ExportRowLimit);
    }

    /// <summary>
    /// Filters, counts, sorts and pages in the database, then loads what a card shows for that one page only.
    /// </summary>
    /// <remarks>
    /// Only the page's ids are ever materialised by the sorted query. The second query then brings back
    /// just what a card needs — its sub-category and category, the card fields, the benefit titles — not
    /// the long description, the eligibility rows or every attribute, so the cost of a page is the size of
    /// a page, not of the catalogue.
    /// </remarks>
    public async Task<PagedResult<ProductListItemDto>> SearchAsync(ProductQueryDto query, CancellationToken ct = default)
    {
        var q = await FilteredAsync(query, includeStatus: true, ct);

        var term = query.Search?.Trim();
        // Only the first page of a search counts as a search; paging through its results does not.
        if (!string.IsNullOrWhiteSpace(term) && query.Page == 1)
        {
            await RecordSearchTermAsync(term.ToLower(), ct);
            await _audit.LogAsync(AuditActions.Search, AuditEntityTypes.Search, null, term,
                $"Searched products for \"{term}\"", ct: ct);
        }

        var total = await q.CountAsync(ct);
        var page = query.Page;
        var pageSize = query.PageSize;

        var pageIds = await Sorted(q, query.Sort)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(p => p.Id)
            .ToListAsync(ct);

        var loaded = await _db.Products.AsNoTracking()
            .Include(p => p.SubCategory).ThenInclude(s => s.Category)
            .Include(p => p.FieldValues.Where(v => v.FieldDefinition.DisplayOnCard)).ThenInclude(v => v.FieldDefinition)
            .Include(p => p.Benefits)
            .AsSingleQuery()
            .Where(p => pageIds.Contains(p.Id))
            .ToListAsync(ct);

        var visibility = await CatalogVisibility.LoadAsync(_statuses, ct);
        var byId = loaded.ToDictionary(p => p.Id);
        var items = pageIds.Where(byId.ContainsKey).Select(id => byId[id].ToListItemDto(visibility)).ToList();

        return new PagedResult<ProductListItemDto> { Items = items, Page = page, PageSize = pageSize, TotalCount = total };
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
            // One atomic increment in the database; concurrent viewers never overwrite each other's count.
            await _db.Products.Where(p => p.Id == id).ExecuteUpdateAsync(s => s.SetProperty(p => p.ViewCount, p => p.ViewCount + 1), ct);
        }

        var p = await FullGraph().AsNoTracking().FirstOrDefaultAsync(p => p.Id == id, ct);
        if (p is null) return null;

        if (trackView)
        {
            await _audit.LogAsync(AuditActions.ViewProduct, AuditEntityTypes.Product, p.Id, p.Name, $"Viewed product details for \"{p.Name}\"", ct: ct);
        }
        return p.ToDetailDto(await CatalogVisibility.LoadAsync(_statuses, ct));
    }

    public async Task<ProductDetailDto> CreateAsync(ProductCreateUpdateDto dto, CancellationToken ct = default)
    {
        var sub = await LoadSubCategoryAsync(dto.SubCategoryId, ct);
        var status = await StatusValidation.EnsureValidOrDefaultAsync(_db, StatusEntityTypes.Product, dto.Status, ct);
        var code = CatalogCodes.Normalise(dto.Code);
        await EnsureCodeFreeAsync(code, excludingId: null, ct);
        var values = ProductValueValidator.Accept(sub.FieldDefinitions, dto.FieldValues, await _presets.GetAsync(ct));

        var product = new Product
        {
            SubCategoryId = sub.Id,
            Name = dto.Name.Trim(),
            Code = code,
            ShortDescription = dto.ShortDescription.Trim(),
            Description = dto.Description.Trim(),
            IconKey = dto.IconKey.Trim(),
            Status = status,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        Apply(product, values, dto);

        _db.Products.Add(product);
        await _db.SaveOrReportDuplicateAsync($"A product with the code \"{code}\" already exists.", ct);
        await _audit.LogAsync(AuditActions.CreateProduct, AuditEntityTypes.Product, product.Id, product.Name, $"Created product \"{product.Name}\" in \"{sub.Name}\"", ct: ct);
        return (await GetByIdAsync(product.Id, trackView: false, ct))!;
    }

    public async Task<ProductDetailDto?> UpdateAsync(Guid id, ProductCreateUpdateDto dto, CancellationToken ct = default)
    {
        var product = await _db.Products
            .Include(p => p.FieldValues)
            .Include(p => p.Benefits)
            .Include(p => p.EligibilityCriteria)
            .FirstOrDefaultAsync(p => p.Id == id, ct);
        if (product is null) return null;

        var sub = await LoadSubCategoryAsync(dto.SubCategoryId, ct);
        var status = await StatusValidation.EnsureValidOrDefaultAsync(_db, StatusEntityTypes.Product, dto.Status, ct);
        var code = CatalogCodes.Normalise(dto.Code);
        await EnsureCodeFreeAsync(code, excludingId: id, ct);
        var values = ProductValueValidator.Accept(sub.FieldDefinitions, dto.FieldValues, await _presets.GetAsync(ct));

        product.SubCategoryId = sub.Id;
        product.Name = dto.Name.Trim();
        product.Code = code;
        product.ShortDescription = dto.ShortDescription.Trim();
        product.Description = dto.Description.Trim();
        product.IconKey = dto.IconKey.Trim();
        product.Status = status;
        product.UpdatedAt = DateTime.UtcNow;

        // Replaced wholesale: the form always sends the whole product, and a product moved to another
        // sub-category must not keep values for fields that sub-category does not have.
        _db.ProductFieldValues.RemoveRange(product.FieldValues);
        _db.ProductBenefits.RemoveRange(product.Benefits);
        _db.ProductEligibilities.RemoveRange(product.EligibilityCriteria);

        Apply(product, values, dto);

        await _db.SaveOrReportDuplicateAsync($"A product with the code \"{code}\" already exists.", ct);
        await _audit.LogAsync(AuditActions.UpdateProduct, AuditEntityTypes.Product, product.Id, product.Name, $"Updated product \"{product.Name}\"", ct: ct);
        return await GetByIdAsync(id, trackView: false, ct);
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var product = await _db.Products.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (product is null) return false;

        // Its values, benefits and eligibility rows go with it through the foreign keys' cascade, in the
        // database, so nothing has to be loaded to be removed.
        _db.Products.Remove(product);
        await _db.SaveChangesAsync(ct);

        await _audit.LogAsync(AuditActions.DeleteProduct, AuditEntityTypes.Product, id, product.Name, $"Deleted product \"{product.Name}\"", ct: ct);
        return true;
    }

    public async Task<ProductDetailDto?> UpdateStatusAsync(Guid id, string status, CancellationToken ct = default)
    {
        var product = await _db.Products.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (product is null) return null;

        var canonical = await StatusValidation.EnsureValidAsync(_db, StatusEntityTypes.Product, status, ct);
        var previousStatus = product.Status;
        product.Status = canonical;
        product.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        await _audit.LogAsync(AuditActions.ProductStatusChange, AuditEntityTypes.Product, product.Id, product.Name,
            $"Changed status of \"{product.Name}\" from {previousStatus} to {product.Status}", previousValue: previousStatus, newValue: product.Status, ct: ct);
        return await GetByIdAsync(id, trackView: false, ct);
    }

    private async Task<SubCategory> LoadSubCategoryAsync(Guid id, CancellationToken ct) =>
        await _db.SubCategories.AsNoTracking().Include(s => s.FieldDefinitions).FirstOrDefaultAsync(s => s.Id == id, ct)
        ?? throw new InvalidOperationException("Choose an existing sub-category for this product.");

    private async Task EnsureCodeFreeAsync(string code, Guid? excludingId, CancellationToken ct)
    {
        if (await _db.Products.AnyAsync(p => p.Id != excludingId && p.Code == code, ct))
            throw new InvalidOperationException($"A product with the code \"{code}\" already exists.");
    }

    /// <summary>
    /// Adds the product's attribute values, benefits and eligibility rows to the context.
    /// </summary>
    /// <remarks>
    /// They are added explicitly, not to the product's collections. A child carries a Guid id from the
    /// moment it is constructed, and EF treats an entity with a key already set — found by walking a
    /// tracked parent's collection — as one that already exists, so it sent an UPDATE for a row that was
    /// never inserted and the whole save failed. Adding through the set marks it as new.
    /// </remarks>
    private void Apply(Product product, IEnumerable<AcceptedFieldValue> values, ProductCreateUpdateDto dto)
    {
        foreach (var v in values)
        {
            _db.ProductFieldValues.Add(new ProductFieldValue
            {
                ProductId = product.Id,
                FieldDefinitionId = v.Definition.Id,
                Value = v.Value,
                NumericValue = v.Numeric
            });
        }

        var order = 0;
        foreach (var b in dto.Benefits.Where(b => !string.IsNullOrWhiteSpace(b.Title)))
            _db.ProductBenefits.Add(new ProductBenefit { ProductId = product.Id, Title = b.Title.Trim(), Description = b.Description.Trim(), IconKey = b.IconKey.Trim(), SortOrder = order++ });

        order = 0;
        foreach (var e in dto.EligibilityCriteria.Where(e => !string.IsNullOrWhiteSpace(e.Criteria)))
            _db.ProductEligibilities.Add(new ProductEligibility { ProductId = product.Id, Criteria = e.Criteria.Trim(), Description = e.Description.Trim(), SortOrder = order++ });
    }
}
