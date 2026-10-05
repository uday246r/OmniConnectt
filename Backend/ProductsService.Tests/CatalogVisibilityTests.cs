using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Application.Common;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Domain.Entities;
using ProductMarketplace.Infrastructure.Data;
using Xunit;

namespace ProductsService.Tests;

/// <summary>
/// What the catalogue shows, and the rule that decides it: a product is visible only when its own status,
/// its sub-category's and its category's are all live.
/// </summary>
/// <remarks>
/// <para>
/// The requirement is "mark a category inactive and its products disappear from the UI". The way to get
/// that wrong is to <i>do</i> it — write Inactive onto every sub-category and product beneath — because
/// that destroys what each held before, so switching the category back on cannot restore anything: a
/// product that was deliberately a draft comes back live. These tests hold the catalogue to deriving
/// visibility at query time, so the category flips and nothing beneath it is ever touched.
/// </para>
/// <para>
/// They also pin that "live" is whatever Setup says, not the word "Active", and that a status typed in
/// the wrong case is stored as Setup spells it — otherwise it would be accepted and never shown.
/// </para>
/// </remarks>
public class CatalogVisibilityTests : IDisposable
{
    private readonly AppDbContext db = TestDb.Create();
    private readonly Catalogue catalogue;

    public CatalogVisibilityTests() => catalogue = new Catalogue(db);

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    private async Task<string[]> ShownAsync() =>
        (await catalogue.Products().SearchAsync(new ProductQueryDto { VisibleOnly = true, PageSize = 100 })).Items.Select(p => p.Code).Order().ToArray();

    private async Task<string[]> ManagedAsync() =>
        (await catalogue.Products().SearchAsync(new ProductQueryDto { PageSize = 100 })).Items.Select(p => p.Code).Order().ToArray();

    private Task SetCategoryStatusAsync(Category category, string status) =>
        catalogue.Categories.UpdateAsync(category.Id, new CategoryCreateUpdateDto { Name = category.Name, Code = category.Code, Status = status });

    private async Task<string> StatusOfAsync(Guid productId) =>
        (await db.Products.AsNoTracking().SingleAsync(p => p.Id == productId)).Status;

    [Fact]
    public async Task A_product_is_shown_when_it_and_everything_above_it_are_live()
    {
        await catalogue.SeedStatusesAsync();
        await catalogue.AddLiveChainAsync();

        Assert.Equal(["HL_001"], await ShownAsync());
    }

    [Fact]
    public async Task A_product_that_is_not_live_itself_is_not_shown_even_under_live_parents()
    {
        await catalogue.SeedStatusesAsync();
        var (_, sub, _) = await catalogue.AddLiveChainAsync();
        await catalogue.AddProductAsync(sub, "A draft", "HL_002", status: "Draft");

        Assert.Equal(["HL_001"], await ShownAsync());
    }

    [Fact]
    public async Task Making_a_category_inactive_hides_everything_beneath_it_but_leaves_the_admin_list_whole()
    {
        await catalogue.SeedStatusesAsync();
        var (category, sub, _) = await catalogue.AddLiveChainAsync();
        await catalogue.AddProductAsync(sub, "Car Loan", "CL_001");

        await SetCategoryStatusAsync(category, "Inactive");

        Assert.Empty(await ShownAsync());
        // The people managing the catalogue must still find what they hid, or they could never switch it back on.
        Assert.Equal(["CL_001", "HL_001"], await ManagedAsync());
    }

    [Fact]
    public async Task Making_a_category_inactive_writes_nothing_onto_the_records_beneath_it()
    {
        await catalogue.SeedStatusesAsync();
        var (category, sub, live) = await catalogue.AddLiveChainAsync();
        var draft = await catalogue.AddProductAsync(sub, "A draft", "HL_002", status: "Draft");

        await SetCategoryStatusAsync(category, "Inactive");

        Assert.Equal("Active", await StatusOfAsync(live.Id));
        Assert.Equal("Draft", await StatusOfAsync(draft.Id));
        Assert.Equal("Active", (await db.SubCategories.AsNoTracking().SingleAsync(s => s.Id == sub.Id)).Status);
    }

    /// <summary>The reason the status is derived: switching the category back on must not resurrect a draft.</summary>
    [Fact]
    public async Task Reactivating_a_category_restores_each_product_exactly_as_it_was()
    {
        await catalogue.SeedStatusesAsync();
        var (category, sub, _) = await catalogue.AddLiveChainAsync();
        await catalogue.AddProductAsync(sub, "A draft", "HL_002", status: "Draft");
        await catalogue.AddProductAsync(sub, "Retired", "HL_003", status: "Inactive");

        await SetCategoryStatusAsync(category, "Inactive");
        await SetCategoryStatusAsync(category, "Active");

        // Only the one that was live is live again; the draft and the retired product stay what they were.
        Assert.Equal(["HL_001"], await ShownAsync());
    }

    [Fact]
    public async Task An_inactive_sub_category_hides_its_own_products_and_not_its_siblings()
    {
        await catalogue.SeedStatusesAsync();
        var (category, home, _) = await catalogue.AddLiveChainAsync();
        var car = await catalogue.AddSubCategoryAsync(category, "Car Loan", "LN-CR", order: 2);
        await catalogue.AddProductAsync(car, "Car Loan – New", "CL_001");

        await catalogue.SubCategories.UpdateAsync(home.Id, new SubCategoryCreateUpdateDto { CategoryId = category.Id, Name = home.Name, Code = home.Code, Status = "Inactive" });

        Assert.Equal(["CL_001"], await ShownAsync());
    }

    [Fact]
    public async Task Only_one_category_going_inactive_affects_only_its_own_products()
    {
        await catalogue.SeedStatusesAsync();
        var (loans, _, _) = await catalogue.AddLiveChainAsync();
        var cards = await catalogue.AddCategoryAsync("Credit Cards", "CC", order: 2);
        var cashback = await catalogue.AddSubCategoryAsync(cards, "Cashback", "CC-CB");
        await catalogue.AddProductAsync(cashback, "Cashback Card", "CC_001");

        await SetCategoryStatusAsync(loans, "Inactive");

        Assert.Equal(["CC_001"], await ShownAsync());
    }

    [Fact]
    public async Task What_counts_as_live_comes_from_Setup_not_from_the_word_Active()
    {
        await catalogue.SeedStatusesAsync();
        var (_, sub, active) = await catalogue.AddLiveChainAsync();
        var published = await catalogue.AddProductAsync(sub, "Published one", "HL_002", status: "Published");
        db.StatusConfigs.Add(Catalogue.Status(StatusEntityTypes.Product, "Published", live: true, order: 4));
        await db.SaveChangesAsync();

        Assert.Equal(["HL_001", "HL_002"], await ShownAsync());

        // An administrator decides "Active" no longer means live: the same product disappears, no code involved.
        var setup = await db.StatusConfigs.SingleAsync(s => s.EntityType == StatusEntityTypes.Product && s.Value == "Active");
        setup.IsLive = false;
        await db.SaveChangesAsync();

        Assert.Equal(["HL_002"], await ShownAsync());
        Assert.Equal("Active", await StatusOfAsync(active.Id));
        Assert.Equal("Published", await StatusOfAsync(published.Id));
    }

    /// <summary>
    /// Validation is case-insensitive, but visibility compares stored to configured values exactly — so a
    /// product saved as "active" would otherwise be valid, accepted, and never appear.
    /// </summary>
    [Fact]
    public async Task A_status_typed_in_another_case_is_stored_as_Setup_spells_it_and_the_product_is_shown()
    {
        await catalogue.SeedStatusesAsync();
        var category = await catalogue.AddCategoryAsync();
        var sub = await catalogue.AddSubCategoryAsync(category);

        var created = await catalogue.Products().CreateAsync(new ProductCreateUpdateDto { SubCategoryId = sub.Id, Name = "Home Loan", Code = "hl_001", Status = "active" });

        Assert.Equal("Active", created.Status);
        Assert.Equal(["HL_001"], await ShownAsync());
    }

    [Fact]
    public async Task A_product_reports_whether_it_is_visible_and_a_category_whether_it_is_live()
    {
        await catalogue.SeedStatusesAsync();
        var (category, _, product) = await catalogue.AddLiveChainAsync();

        Assert.True((await catalogue.Products().GetByIdAsync(product.Id, trackView: false))!.IsVisible);
        Assert.True((await catalogue.Categories.GetByIdAsync(category.Id))!.IsLive);

        await SetCategoryStatusAsync(category, "Inactive");

        var hidden = (await catalogue.Products().GetByIdAsync(product.Id, trackView: false))!;
        Assert.False(hidden.IsVisible);
        // Its own status is still live — it is hidden by what is above it, and the screen can say so.
        Assert.Equal("Active", hidden.Status);
        Assert.False((await catalogue.Categories.GetByIdAsync(category.Id))!.IsLive);
    }

    [Fact]
    public async Task A_status_filter_narrows_the_admin_list_without_changing_what_is_visible()
    {
        await catalogue.SeedStatusesAsync();
        var (_, sub, _) = await catalogue.AddLiveChainAsync();
        await catalogue.AddProductAsync(sub, "A draft", "HL_002", status: "Draft");

        var drafts = await catalogue.Products().SearchAsync(new ProductQueryDto { Status = "Draft" });

        Assert.Equal(["HL_002"], drafts.Items.Select(p => p.Code));
        Assert.All(drafts.Items, p => Assert.False(p.IsVisible));
    }
}
