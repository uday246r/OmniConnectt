using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Infrastructure.Data;
using Xunit;

namespace ProductsService.Tests;

/// <summary>
/// Categories — the top of the catalogue's three levels — and the housekeeping that keeps them usable.
/// </summary>
/// <remarks>
/// Categories used to be a self-referencing tree whose children were never shown, with a rollup that
/// walked it to count products. They are now flat, and a code and a name each identify one. These tests
/// pin the parts an administrator relies on without thinking about them: codes that cannot collide by
/// case, a display order that stays 1..N whatever is added, moved or removed, counts that describe the
/// whole catalogue rather than the page on screen, and refusing to delete what still has children.
/// </remarks>
public class CategoryServiceTests : IDisposable
{
    private readonly AppDbContext db = TestDb.Create();
    private readonly Catalogue catalogue;

    public CategoryServiceTests() => catalogue = new Catalogue(db);

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    private static CategoryCreateUpdateDto Dto(string name, string code, string status = "", int order = 0) =>
        new() { Name = name, Code = code, Status = status, DisplayOrder = order };

    private async Task<int[]> OrdersAsync() =>
        (await db.Categories.AsNoTracking().OrderBy(c => c.DisplayOrder).Select(c => c.DisplayOrder).ToListAsync()).ToArray();

    // ---------------------------------------------------------------- create

    [Fact]
    public async Task A_code_is_stored_trimmed_and_upper_case_so_two_cases_cannot_both_exist()
    {
        await catalogue.SeedStatusesAsync();

        var created = await catalogue.Categories.CreateAsync(Dto("  Credit Cards ", " cc "));

        Assert.Equal("CC", created.Code);
        Assert.Equal("Credit Cards", created.Name);
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => catalogue.Categories.CreateAsync(Dto("Charge Cards", "cC")));
        Assert.Contains("\"CC\" is already used", error.Message);
    }

    [Fact]
    public async Task A_name_is_unique_whatever_its_case()
    {
        await catalogue.SeedStatusesAsync();
        await catalogue.Categories.CreateAsync(Dto("Loans", "LN"));

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => catalogue.Categories.CreateAsync(Dto("LOANS", "LO")));

        Assert.Contains("already exists", error.Message);
    }

    [Fact]
    public async Task With_no_status_given_a_new_category_takes_the_default_from_Setup()
    {
        await catalogue.SeedStatusesAsync();

        var created = await catalogue.Categories.CreateAsync(Dto("Loans", "LN"));

        Assert.Equal("Active", created.Status);
        Assert.True(created.IsLive);
    }

    [Fact]
    public async Task A_status_Setup_does_not_know_is_refused_with_the_ones_it_does()
    {
        await catalogue.SeedStatusesAsync();

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => catalogue.Categories.CreateAsync(Dto("Loans", "LN", "Archived")));

        Assert.Contains("'Archived' is not a valid status for Category", error.Message);
        Assert.Contains("Active", error.Message);
    }

    [Fact]
    public async Task Nothing_can_be_created_until_Setup_has_a_status_to_give_it()
    {
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => catalogue.Categories.CreateAsync(Dto("Loans", "LN")));

        Assert.Contains("No enabled Category status is configured", error.Message);
    }

    // ---------------------------------------------------------------- display order

    [Fact]
    public async Task New_categories_join_the_end_of_the_order()
    {
        await catalogue.SeedStatusesAsync();

        await catalogue.Categories.CreateAsync(Dto("Loans", "LN"));
        await catalogue.Categories.CreateAsync(Dto("Cards", "CC"));
        var third = await catalogue.Categories.CreateAsync(Dto("Deposits", "DP"));

        Assert.Equal(3, third.DisplayOrder);
        Assert.Equal(new[] { 1, 2, 3 }, await OrdersAsync());
    }

    [Fact]
    public async Task A_category_created_at_a_position_pushes_the_others_down_without_leaving_a_gap()
    {
        await catalogue.SeedStatusesAsync();
        await catalogue.Categories.CreateAsync(Dto("Loans", "LN"));
        await catalogue.Categories.CreateAsync(Dto("Cards", "CC"));

        var first = await catalogue.Categories.CreateAsync(Dto("Deposits", "DP", order: 1));

        Assert.Equal(1, first.DisplayOrder);
        Assert.Equal(new[] { 1, 2, 3 }, await OrdersAsync());
        Assert.Equal(["Deposits", "Loans", "Cards"], (await catalogue.Categories.SearchAsync(new CategoryQueryDto())).Items.Select(c => c.Name));
    }

    [Fact]
    public async Task Moving_a_category_up_swaps_it_with_its_neighbour_and_the_top_one_stays_put()
    {
        await catalogue.SeedStatusesAsync();
        var loans = await catalogue.Categories.CreateAsync(Dto("Loans", "LN"));
        var cards = await catalogue.Categories.CreateAsync(Dto("Cards", "CC"));

        await catalogue.Categories.ReorderAsync(cards.Id, "up");
        await catalogue.Categories.ReorderAsync(cards.Id, "up");

        Assert.Equal(["Cards", "Loans"], (await catalogue.Categories.SearchAsync(new CategoryQueryDto())).Items.Select(c => c.Name));
        Assert.Equal(new[] { 1, 2 }, await OrdersAsync());
        Assert.Equal(2, (await catalogue.Categories.GetByIdAsync(loans.Id))!.DisplayOrder);
    }

    [Fact]
    public async Task Deleting_a_category_closes_the_gap_it_leaves()
    {
        await catalogue.SeedStatusesAsync();
        await catalogue.Categories.CreateAsync(Dto("Loans", "LN"));
        var middle = await catalogue.Categories.CreateAsync(Dto("Cards", "CC"));
        await catalogue.Categories.CreateAsync(Dto("Deposits", "DP"));

        Assert.True(await catalogue.Categories.DeleteAsync(middle.Id));

        Assert.Equal(new[] { 1, 2 }, await OrdersAsync());
    }

    // ---------------------------------------------------------------- update / delete

    [Fact]
    public async Task A_category_can_be_saved_again_under_its_own_name_and_code()
    {
        await catalogue.SeedStatusesAsync();
        var loans = await catalogue.Categories.CreateAsync(Dto("Loans", "LN"));

        var updated = await catalogue.Categories.UpdateAsync(loans.Id, new CategoryCreateUpdateDto { Name = "Loans", Code = "LN", Description = "Personal and home loans", Status = "Active" });

        Assert.Equal("Personal and home loans", updated!.Description);
    }

    [Fact]
    public async Task A_category_cannot_take_another_categorys_code()
    {
        await catalogue.SeedStatusesAsync();
        await catalogue.Categories.CreateAsync(Dto("Loans", "LN"));
        var cards = await catalogue.Categories.CreateAsync(Dto("Cards", "CC"));

        await Assert.ThrowsAsync<InvalidOperationException>(() => catalogue.Categories.UpdateAsync(cards.Id, Dto("Cards", "LN", "Active")));
    }

    [Fact]
    public async Task Updating_or_deleting_a_category_that_does_not_exist_reports_nothing_found()
    {
        await catalogue.SeedStatusesAsync();

        Assert.Null(await catalogue.Categories.UpdateAsync(Guid.NewGuid(), Dto("Loans", "LN")));
        Assert.False(await catalogue.Categories.DeleteAsync(Guid.NewGuid()));
        Assert.Null(await catalogue.Categories.ReorderAsync(Guid.NewGuid(), "up"));
    }

    [Fact]
    public async Task A_category_that_still_has_sub_categories_cannot_be_deleted()
    {
        await catalogue.SeedStatusesAsync();
        var (category, _, _) = await catalogue.AddLiveChainAsync();

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => catalogue.Categories.DeleteAsync(category.Id));

        Assert.Contains("still has sub-categories", error.Message);
        Assert.Contains("mark the category inactive", error.Message);
        Assert.NotNull(await catalogue.Categories.GetByIdAsync(category.Id));
    }

    // ---------------------------------------------------------------- listing

    [Fact]
    public async Task Counts_describe_the_whole_catalogue_beneath_each_category_not_the_page_on_screen()
    {
        await catalogue.SeedStatusesAsync();
        var loans = await catalogue.AddCategoryAsync();
        var home = await catalogue.AddSubCategoryAsync(loans, "Home Loan", "LN-HM", order: 1);
        var car = await catalogue.AddSubCategoryAsync(loans, "Car Loan", "LN-CR", order: 2);
        await catalogue.AddProductAsync(home, code: "HL_1");
        await catalogue.AddProductAsync(home, code: "HL_2", status: "Draft");
        await catalogue.AddProductAsync(car, code: "CL_1");
        await catalogue.AddCategoryAsync("Cards", "CC", order: 2);

        var page = await catalogue.Categories.SearchAsync(new CategoryQueryDto());

        var loanRow = page.Items.Single(c => c.Code == "LN");
        Assert.Equal(2, loanRow.SubCategoryCount);
        // Every product, whatever its status — this is what an administrator asks "how many are in here?" for.
        Assert.Equal(3, loanRow.ProductCount);
        Assert.Equal((0, 0), (page.Items.Single(c => c.Code == "CC").SubCategoryCount, page.Items.Single(c => c.Code == "CC").ProductCount));
    }

    [Fact]
    public async Task The_list_searches_name_code_and_description_and_filters_by_status()
    {
        await catalogue.SeedStatusesAsync();
        await catalogue.Categories.CreateAsync(new CategoryCreateUpdateDto { Name = "Loans", Code = "LN", Description = "Home and car finance", Status = "Active" });
        await catalogue.Categories.CreateAsync(Dto("Credit Cards", "CC", "Active"));
        await catalogue.Categories.CreateAsync(Dto("Old Schemes", "OS", "Inactive"));

        Assert.Equal(["Loans"], (await catalogue.Categories.SearchAsync(new CategoryQueryDto { Search = "car fin" })).Items.Select(c => c.Name));
        Assert.Equal(["Credit Cards"], (await catalogue.Categories.SearchAsync(new CategoryQueryDto { Search = "cc" })).Items.Select(c => c.Name));
        Assert.Equal(["Old Schemes"], (await catalogue.Categories.SearchAsync(new CategoryQueryDto { Status = "Inactive" })).Items.Select(c => c.Name));
    }

    [Fact]
    public async Task The_list_sorts_by_name_or_by_how_many_products_a_category_holds()
    {
        await catalogue.SeedStatusesAsync();
        var quiet = await catalogue.AddCategoryAsync("Alpha", "AL", order: 1);
        var busy = await catalogue.AddCategoryAsync("Zeta", "ZE", order: 2);
        var sub = await catalogue.AddSubCategoryAsync(busy, "Zeta Type", "ZE-T");
        await catalogue.AddProductAsync(sub, code: "Z1");
        await catalogue.AddProductAsync(sub, code: "Z2");

        Assert.Equal(["Zeta", "Alpha"], (await catalogue.Categories.SearchAsync(new CategoryQueryDto { Sort = "-name" })).Items.Select(c => c.Name));
        Assert.Equal(["Zeta", "Alpha"], (await catalogue.Categories.SearchAsync(new CategoryQueryDto { Sort = "-products" })).Items.Select(c => c.Name));
        Assert.Equal(quiet.Name, (await catalogue.Categories.SearchAsync(new CategoryQueryDto { Sort = "products" })).Items[0].Name);
    }

    [Fact]
    public async Task An_unknown_sort_reads_as_the_configured_order_rather_than_failing()
    {
        await catalogue.SeedStatusesAsync();
        await catalogue.Categories.CreateAsync(Dto("Loans", "LN"));
        await catalogue.Categories.CreateAsync(Dto("Cards", "CC"));

        var page = await catalogue.Categories.SearchAsync(new CategoryQueryDto { Sort = "drop table" });

        Assert.Equal(["Loans", "Cards"], page.Items.Select(c => c.Name));
    }

    [Fact]
    public async Task Paging_reports_the_total_and_walks_every_category_exactly_once()
    {
        await catalogue.SeedStatusesAsync();
        for (var i = 1; i <= 23; i++) await catalogue.Categories.CreateAsync(Dto($"Category {i:00}", $"C{i:00}"));

        var seen = new List<string>();
        for (var page = 1; page <= 3; page++)
        {
            var result = await catalogue.Categories.SearchAsync(new CategoryQueryDto { Page = page, PageSize = 10 });
            Assert.Equal(23, result.TotalCount);
            Assert.Equal(3, result.TotalPages);
            seen.AddRange(result.Items.Select(c => c.Code));
        }

        Assert.Equal(23, seen.Distinct().Count());
        Assert.Equal("C01", seen[0]);
        Assert.Equal("C23", seen[^1]);
    }
}
