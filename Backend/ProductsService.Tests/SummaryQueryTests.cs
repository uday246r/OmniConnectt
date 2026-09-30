using ProductMarketplace.Application.Common;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Domain.Entities;
using ProductMarketplace.Infrastructure.Data;
using ProductMarketplace.Infrastructure.Services;
using Xunit;
using DomainAuditLog = ProductMarketplace.Domain.Entities.AuditLog;

namespace ProductsService.Tests;

/// <summary>
/// The dashboard's figures and breakdowns, counted by the database.
/// </summary>
/// <remarks>
/// <para>
/// The summary asks for every figure in one grouped query per table instead of one query per number —
/// with the database a few hundred milliseconds away the difference was seconds before the page could
/// show anything. These pin that each figure still means what it says, including the comparison with an
/// earlier date and an empty table, where a grouped query returns no row at all.
/// </para>
/// <para>
/// Figures carry a key, never a label, so what to call them is the screen's decision; and "live" is
/// whatever Setup says, so the counts never compare a status to a literal.
/// </para>
/// </remarks>
public class SummaryQueryTests : IDisposable
{
    private readonly AppDbContext db = TestDb.Create();
    private readonly Catalogue catalogue;

    public SummaryQueryTests() => catalogue = new Catalogue(db);

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    // ---------------------------------------------------------------- summary

    [Fact]
    public async Task The_summary_counts_each_figure_now_and_before_the_comparison_window()
    {
        await catalogue.SeedStatusesAsync();
        var old = DateTime.UtcNow.AddDays(-30);
        var recent = DateTime.UtcNow.AddDays(-1);

        var loans = new Category { Name = "Loans", Code = "LN", Status = "Active", CreatedAt = old };
        var cards = new Category { Name = "Cards", Code = "CC", Status = "Active", CreatedAt = recent };
        var home = new SubCategory { CategoryId = loans.Id, Name = "Home Loan", Code = "LN-HM", Status = "Active", CreatedAt = old };
        db.AddRange(loans, cards, home);
        db.Products.AddRange(
            new Product { SubCategoryId = home.Id, Name = "Old active", Code = "P1", Status = "Active", CreatedAt = old },
            new Product { SubCategoryId = home.Id, Name = "New active", Code = "P2", Status = "Active", CreatedAt = recent },
            new Product { SubCategoryId = home.Id, Name = "Old draft", Code = "P3", Status = "Draft", CreatedAt = old });
        await db.SaveChangesAsync();

        var summary = await catalogue.Dashboard.GetSummaryAsync(comparedDays: 7);

        Assert.Equal(3, summary.TotalProducts.Value);
        Assert.Equal(2, summary.LiveProducts.Value);
        Assert.Equal(1, summary.UnpublishedProducts.Value);
        Assert.Equal(2, summary.TotalCategories.Value);
        Assert.Equal(1, summary.TotalSubCategories.Value);
        // Before the window: 2 products (1 live, 1 not), 1 category, 1 sub-category.
        Assert.Equal(50, summary.TotalProducts.ChangePercent);
        Assert.Equal(100, summary.LiveProducts.ChangePercent);
        Assert.Equal(0, summary.UnpublishedProducts.ChangePercent);
        Assert.Equal(100, summary.TotalCategories.ChangePercent);
        Assert.Equal(0, summary.TotalSubCategories.ChangePercent);
        Assert.Equal(7, summary.ComparedDays);
    }

    [Fact]
    public async Task The_summary_is_all_zero_for_an_empty_catalogue()
    {
        await catalogue.SeedStatusesAsync();

        var summary = await catalogue.Dashboard.GetSummaryAsync(30);

        Assert.All([summary.TotalProducts, summary.LiveProducts, summary.UnpublishedProducts, summary.TotalCategories, summary.TotalSubCategories],
            k => Assert.Equal((0d, 0d), (k.Value, k.ChangePercent)));
    }

    [Fact]
    public async Task Figures_carry_keys_for_the_screen_to_name_not_labels_built_here()
    {
        await catalogue.SeedStatusesAsync();

        var summary = await catalogue.Dashboard.GetSummaryAsync(30);

        Assert.Equal(["totalProducts", "liveProducts", "unpublishedProducts", "totalCategories", "totalSubCategories"],
            new[] { summary.TotalProducts, summary.LiveProducts, summary.UnpublishedProducts, summary.TotalCategories, summary.TotalSubCategories }.Select(k => k.Key));
    }

    [Fact]
    public async Task Live_means_whatever_Setup_says_so_a_second_live_status_counts()
    {
        await catalogue.SeedStatusesAsync();
        var (_, sub, _) = await catalogue.AddLiveChainAsync();
        await catalogue.AddProductAsync(sub, "Featured", "HL_002", status: "Featured");
        db.StatusConfigs.Add(Catalogue.Status(StatusEntityTypes.Product, "Featured", live: true, order: 4));
        await db.SaveChangesAsync();

        var summary = await catalogue.Dashboard.GetSummaryAsync(30);

        Assert.Equal((2d, 0d), (summary.LiveProducts.Value, summary.UnpublishedProducts.Value));
    }

    // ---------------------------------------------------------------- breakdowns

    [Fact]
    public async Task Products_are_broken_down_per_category_in_display_order_counting_every_status()
    {
        await catalogue.SeedStatusesAsync();
        var cards = await catalogue.AddCategoryAsync("Credit Cards", "CC", order: 2);
        var loans = await catalogue.AddCategoryAsync("Loans", "LN", order: 1);
        var home = await catalogue.AddSubCategoryAsync(loans, "Home Loan", "LN-HM", order: 1);
        var car = await catalogue.AddSubCategoryAsync(loans, "Car Loan", "LN-CR", order: 2);
        var cashback = await catalogue.AddSubCategoryAsync(cards, "Cashback", "CC-CB");
        await catalogue.AddProductAsync(home, code: "H1");
        await catalogue.AddProductAsync(home, code: "H2", status: "Draft");
        await catalogue.AddProductAsync(car, code: "C1");
        await catalogue.AddProductAsync(cashback, code: "K1");

        var breakdown = await catalogue.Dashboard.GetProductBreakdownAsync(categoryId: null);

        Assert.Equal([("Loans", 3), ("Credit Cards", 1)], breakdown.Select(b => (b.Name, b.Count)));
    }

    [Fact]
    public async Task Choosing_one_category_breaks_it_down_by_sub_category_instead()
    {
        await catalogue.SeedStatusesAsync();
        var loans = await catalogue.AddCategoryAsync();
        var home = await catalogue.AddSubCategoryAsync(loans, "Home Loan", "LN-HM", order: 1);
        await catalogue.AddSubCategoryAsync(loans, "Car Loan", "LN-CR", order: 2);
        var cards = await catalogue.AddCategoryAsync("Cards", "CC", order: 2);
        await catalogue.AddSubCategoryAsync(cards, "Cashback", "CC-CB");
        await catalogue.AddProductAsync(home, code: "H1");

        var breakdown = await catalogue.Dashboard.GetProductBreakdownAsync(loans.Id);

        Assert.Equal([("Home Loan", 1), ("Car Loan", 0)], breakdown.Select(b => (b.Name, b.Count)));
        Assert.Equal(["LN-HM", "LN-CR"], breakdown.Select(b => b.Code));
    }

    [Fact]
    public async Task The_status_distribution_reports_each_status_with_its_share()
    {
        await catalogue.SeedStatusesAsync();
        var (_, sub, _) = await catalogue.AddLiveChainAsync();
        await catalogue.AddProductAsync(sub, code: "P2");
        await catalogue.AddProductAsync(sub, code: "P3", status: "Draft");
        await catalogue.AddProductAsync(sub, code: "P4", status: "Inactive");

        var distribution = await catalogue.Dashboard.GetProductStatusDistributionAsync();

        Assert.Equal(("Active", 2, 50d), (distribution[0].Status, distribution[0].Count, distribution[0].Percentage));
        Assert.Equal(4, distribution.Sum(d => d.Count));
        Assert.Equal(100d, distribution.Sum(d => d.Percentage));
    }

    [Fact]
    public async Task The_status_distribution_of_an_empty_catalogue_is_empty_not_an_error()
    {
        Assert.Empty(await catalogue.Dashboard.GetProductStatusDistributionAsync());
    }

    [Fact]
    public async Task Recent_products_are_newest_first_and_say_where_each_sits()
    {
        await catalogue.SeedStatusesAsync();
        var loans = await catalogue.AddCategoryAsync();
        var home = await catalogue.AddSubCategoryAsync(loans);
        await catalogue.AddProductAsync(home, "Older", "P1", createdAt: DateTime.UtcNow.AddDays(-3));
        await catalogue.AddProductAsync(home, "Newest", "P2", createdAt: DateTime.UtcNow);

        var recent = await catalogue.Dashboard.GetRecentProductsAsync(take: 1);

        var only = Assert.Single(recent);
        Assert.Equal(("Newest", "Loans", "Home Loan"), (only.Name, only.CategoryName, only.SubCategoryName));
    }

    [Fact]
    public async Task Recent_activity_shows_changes_and_leaves_out_searches_and_product_views()
    {
        var now = DateTime.UtcNow;
        db.AuditLogs.AddRange(
            new DomainAuditLog { Action = AuditActions.CreateProduct, EntityType = "Product", EntityName = "Gold Card", ActorName = "Asha", Timestamp = now.AddMinutes(-3) },
            new DomainAuditLog { Action = AuditActions.Search, EntityType = "Search", EntityName = "home loan", Timestamp = now.AddMinutes(-2) },
            new DomainAuditLog { Action = AuditActions.ViewProduct, EntityType = "Product", EntityName = "Gold Card", Timestamp = now.AddMinutes(-1) },
            new DomainAuditLog { Action = AuditActions.CreateSubCategory, EntityType = "SubCategory", EntityName = "Cashback", ActorName = "Ben", Timestamp = now });
        await db.SaveChangesAsync();

        var activity = await catalogue.Dashboard.GetRecentActivityAsync(take: 10);

        Assert.Equal([AuditActions.CreateSubCategory, AuditActions.CreateProduct], activity.Select(a => a.Action));
    }

    // ---------------------------------------------------------------- audit

    [Fact]
    public async Task The_audit_summary_counts_totals_successes_and_distinct_kinds_under_the_filters()
    {
        db.AuditLogs.AddRange(
            new DomainAuditLog { Action = "product.created", EntityType = "Product", Success = true },
            new DomainAuditLog { Action = "product.created", EntityType = "Product", Success = false },
            new DomainAuditLog { Action = "category.updated", EntityType = "Category", Success = true });
        await db.SaveChangesAsync();
        var service = new AuditLogService(db, new FixedAuditContext(), new RecordingHub(), new RecordingForwarder());

        var all = await service.GetSummaryAsync(new AuditLogQueryDto());
        var productsOnly = await service.GetSummaryAsync(new AuditLogQueryDto { EntityType = "Product" });
        var none = await service.GetSummaryAsync(new AuditLogQueryDto { EntityType = "Nothing" });

        Assert.Equal((3, 2, 1, 2, 2), (all.TotalCount, all.SuccessCount, all.FailureCount, all.ActionTypeCount, all.EntityTypeCount));
        Assert.Equal((2, 1, 1, 1), (productsOnly.TotalCount, productsOnly.SuccessCount, productsOnly.ActionTypeCount, productsOnly.EntityTypeCount));
        Assert.Equal((0, 0, 0, 0), (none.TotalCount, none.SuccessCount, none.ActionTypeCount, none.EntityTypeCount));
    }
}
