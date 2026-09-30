using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Application.Common;
using ProductMarketplace.Application.Interfaces;
using ProductMarketplace.Domain.Entities;
using ProductMarketplace.Infrastructure.Data;

namespace ProductMarketplace.Infrastructure.Services;

/// <summary>
/// Reads which statuses make a record live from Setup, once per request.
/// </summary>
public sealed class CatalogStatuses(AppDbContext db) : ICatalogStatuses
{
    private readonly Dictionary<string, string[]> _live = new();

    public async Task<IReadOnlyCollection<string>> LiveValuesAsync(string entityType, CancellationToken ct = default)
    {
        if (_live.TryGetValue(entityType, out var known)) return known;

        var values = await db.StatusConfigs.AsNoTracking()
            .Where(s => s.EntityType == entityType && s.IsLive)
            .Select(s => s.Value)
            .ToArrayAsync(ct);
        _live[entityType] = values;
        return values;
    }
}

/// <summary>
/// The one definition of "the catalogue shows this product": its own status, its sub-category's and its
/// category's are all live.
/// </summary>
/// <remarks>
/// <para>
/// This is <b>derived at query time and never written down</b>. The tempting alternative — marking a
/// category inactive by writing Inactive onto every sub-category and product beneath it — destroys what
/// each of them held before, so reactivating the category could not restore them: a product that was
/// deliberately a draft would come back live, and one that was live would have to be found and fixed by
/// hand. Here nothing beneath a category is touched; switch the category back on and every record is
/// exactly as it was.
/// </para>
/// <para>
/// "Live" is what Setup says it is (<see cref="StatusConfig.IsLive"/>), not a comparison to "Active".
/// </para>
/// </remarks>
internal sealed class CatalogVisibility
{
    // Held as arrays, and copied into locals before an expression is built, so the database receives each
    // set as a single parameter rather than a closure over this object.
    private readonly string[] _products;
    private readonly string[] _subCategories;
    private readonly string[] _categories;

    private CatalogVisibility(string[] products, string[] subCategories, string[] categories)
    {
        _products = products;
        _subCategories = subCategories;
        _categories = categories;
    }

    public static async Task<CatalogVisibility> LoadAsync(ICatalogStatuses statuses, CancellationToken ct = default) => new(
        (await statuses.LiveValuesAsync(StatusEntityTypes.Product, ct)).ToArray(),
        (await statuses.LiveValuesAsync(StatusEntityTypes.SubCategory, ct)).ToArray(),
        (await statuses.LiveValuesAsync(StatusEntityTypes.Category, ct)).ToArray());

    /// <summary>Only the products the catalogue shows. Needs the product's sub-category and category reachable.</summary>
    public IQueryable<Product> Visible(IQueryable<Product> products)
    {
        var live = _products;
        var liveSub = _subCategories;
        var liveCat = _categories;
        return products.Where(p =>
            live.Contains(p.Status)
            && liveSub.Contains(p.SubCategory.Status)
            && liveCat.Contains(p.SubCategory.Category.Status));
    }

    /// <summary>Only the sub-categories the catalogue shows: live themselves, under a live category.</summary>
    public IQueryable<SubCategory> Visible(IQueryable<SubCategory> subCategories)
    {
        var liveSub = _subCategories;
        var liveCat = _categories;
        return subCategories.Where(s => liveSub.Contains(s.Status) && liveCat.Contains(s.Category.Status));
    }

    public bool IsProductLive(string status) => _products.Contains(status);
    public bool IsSubCategoryLive(string status) => _subCategories.Contains(status);
    public bool IsCategoryLive(string status) => _categories.Contains(status);

    /// <summary>The same rule as <see cref="Visible(IQueryable{Product})"/>, for a product already loaded.</summary>
    public bool IsVisible(Product product) =>
        IsProductLive(product.Status)
        && IsSubCategoryLive(product.SubCategory.Status)
        && IsCategoryLive(product.SubCategory.Category.Status);
}
