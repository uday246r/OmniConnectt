using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Domain.Entities;
using ProductMarketplace.Infrastructure.Data;
using ProductMarketplace.Infrastructure.Services;
using Xunit;

namespace ProductsService.Tests;

/// <summary>
/// What Lead Management is told the catalogue contains.
/// </summary>
/// <remarks>
/// The lead form offers Category → Product from these answers alone, so they must obey the same rule as
/// the Products screen: a category switched off in Setup, a sub-category switched off, or a product that
/// is still a draft must not be offered — and must not be resolvable by id either, or a stale browser tab
/// could still create a lead against something the bank has withdrawn.
/// </remarks>
public class CatalogLookupServiceTests : IDisposable
{
    private readonly AppDbContext db = TestDb.Create();
    private readonly Catalogue catalogue;
    private readonly CatalogLookupService lookup;

    public CatalogLookupServiceTests()
    {
        catalogue = new Catalogue(db);
        lookup = new CatalogLookupService(db, catalogue.Statuses);
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    private Task SetCategoryStatusAsync(Category category, string status) =>
        catalogue.Categories.UpdateAsync(category.Id, new CategoryCreateUpdateDto { Name = category.Name, Code = category.Code, Status = status });

    [Fact]
    public async Task A_category_is_offered_with_the_number_of_products_the_catalogue_shows_in_it()
    {
        await catalogue.SeedStatusesAsync();
        var (_, sub, _) = await catalogue.AddLiveChainAsync();
        await catalogue.AddProductAsync(sub, "Home Loan – Self employed", "HL_002");
        await catalogue.AddProductAsync(sub, "A draft", "HL_003", status: "Draft");

        var categories = await lookup.GetCategoriesAsync();

        var loans = Assert.Single(categories);
        Assert.Equal("Loans", loans.Name);
        Assert.Equal(2, loans.ProductCount);
    }

    [Fact]
    public async Task A_category_with_nothing_to_offer_is_left_out_rather_than_shown_empty()
    {
        await catalogue.SeedStatusesAsync();
        await catalogue.AddLiveChainAsync();
        var cards = await catalogue.AddCategoryAsync("Credit Cards", "CC", order: 2);
        await catalogue.AddSubCategoryAsync(cards, "Cashback", "CC-CB");

        Assert.Equal(["Loans"], (await lookup.GetCategoriesAsync()).Select(c => c.Name));
    }

    [Fact]
    public async Task Switching_a_category_off_removes_it_and_its_products_and_switching_it_on_brings_them_back()
    {
        await catalogue.SeedStatusesAsync();
        var (category, _, product) = await catalogue.AddLiveChainAsync();

        await SetCategoryStatusAsync(category, "Inactive");

        Assert.Empty(await lookup.GetCategoriesAsync());
        Assert.Empty(await lookup.GetProductsAsync(category.Id));
        Assert.Null(await lookup.GetProductAsync(product.Id));
        Assert.Empty(await lookup.GetSubCategoriesAsync());

        await SetCategoryStatusAsync(category, "Active");

        Assert.Single(await lookup.GetCategoriesAsync());
        Assert.NotNull(await lookup.GetProductAsync(product.Id));
    }

    [Fact]
    public async Task Products_in_a_category_are_listed_with_the_sub_category_and_category_they_sit_under()
    {
        await catalogue.SeedStatusesAsync();
        var (category, sub, _) = await catalogue.AddLiveChainAsync();
        var car = await catalogue.AddSubCategoryAsync(category, "Car Loan", "LN-CR", order: 2);
        await catalogue.AddProductAsync(car, "Car Loan – New", "CL_001");

        var products = await lookup.GetProductsAsync(category.Id);

        Assert.Equal(["CL_001", "HL_001"], products.Select(p => p.Code).Order());
        var first = products.Single(p => p.Code == "HL_001");
        Assert.Equal(sub.Id, first.SubCategoryId);
        Assert.Equal("Home Loan", first.SubCategoryName);
        Assert.Equal("LN-HM", first.SubCategoryCode);
        Assert.Equal(category.Id, first.CategoryId);
        Assert.Equal("Loans", first.CategoryName);
        Assert.Equal("LN", first.CategoryCode);
    }

    [Fact]
    public async Task A_product_that_is_not_live_cannot_be_looked_up_by_id()
    {
        await catalogue.SeedStatusesAsync();
        var (_, sub, _) = await catalogue.AddLiveChainAsync();
        var draft = await catalogue.AddProductAsync(sub, "A draft", "HL_002", status: "Draft");

        Assert.Null(await lookup.GetProductAsync(draft.Id));
        Assert.Null(await lookup.GetProductAsync(Guid.NewGuid()));
    }

    [Fact]
    public async Task An_inactive_sub_category_drops_out_of_the_list_but_its_siblings_stay()
    {
        await catalogue.SeedStatusesAsync();
        var (category, home, _) = await catalogue.AddLiveChainAsync();
        await catalogue.AddSubCategoryAsync(category, "Car Loan", "LN-CR", order: 2);

        await catalogue.SubCategories.UpdateAsync(home.Id, new SubCategoryCreateUpdateDto { CategoryId = category.Id, Name = home.Name, Code = home.Code, Status = "Inactive" });

        Assert.Equal(["Car Loan"], (await lookup.GetSubCategoriesAsync()).Select(s => s.Name));
    }
}
