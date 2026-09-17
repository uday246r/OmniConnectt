using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Domain.Entities;
using ProductMarketplace.Infrastructure.Data;
using ProductMarketplace.Infrastructure.Services;
using Xunit;
using DomainApplication = ProductMarketplace.Domain.Entities.Application;
using DomainAuditLog = ProductMarketplace.Domain.Entities.AuditLog;

namespace ProductsService.Tests;

/// <summary>
/// Summary figures that are now counted in grouped queries instead of one query per number.
/// </summary>
/// <remarks>
/// The dashboard summary used to run ten COUNT queries in sequence and the audit summary four; with the
/// database a few hundred milliseconds away that alone took seconds. The rewrite asks for the same
/// numbers with a filter per figure inside one grouped query per table. These tests pin that every
/// figure still means what it did — including the "before the last 7 days" comparisons and an empty
/// table, where a grouped query returns no row at all — and that the Products page's per-status counts,
/// which replaced a full search per status, ignore the status filter but honour the category.
/// </remarks>
public class SummaryQueryTests : IDisposable
{
    private readonly AppDbContext db = TestDb.Create();

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public async Task The_dashboard_summary_counts_each_figure_now_and_before_the_last_seven_days()
    {
        var old = DateTime.UtcNow.AddDays(-30);
        var recent = DateTime.UtcNow.AddDays(-1);
        var product = await CatalogAsync(("Old active", "Active", old), ("New active", "Active", recent), ("Old draft", "Draft", old));
        db.Applications.AddRange(
            new DomainApplication { ApplicationNumber = "A1", ProductId = product.Id, CustomerName = "x", Status = "Approved", CreatedAt = old },
            new DomainApplication { ApplicationNumber = "A2", ProductId = product.Id, CustomerName = "x", Status = "Submitted", CreatedAt = old },
            new DomainApplication { ApplicationNumber = "A3", ProductId = product.Id, CustomerName = "x", Status = "Completed", CreatedAt = recent });
        db.ProductViewLogs.AddRange(
            new ProductViewLog { ProductId = product.Id, ViewedAt = old },
            new ProductViewLog { ProductId = product.Id, ViewedAt = recent });
        await db.SaveChangesAsync();

        var summary = await new DashboardService(db).GetSummaryAsync();

        Assert.Equal(3, summary.TotalProducts.Value);
        Assert.Equal(2, summary.ActiveProducts.Value);
        Assert.Equal(3, summary.TotalApplications.Value);
        Assert.Equal(2, summary.TotalViews.Value);
        Assert.Equal(66.67, summary.ConversionRate.Value);
        // Before the window: 2 products (1 active), 2 applications (1 approved), 1 view.
        Assert.Equal(50, summary.TotalProducts.ChangePercent);
        Assert.Equal(100, summary.ActiveProducts.ChangePercent);
        Assert.Equal(100, summary.TotalViews.ChangePercent);
    }

    [Fact]
    public async Task The_dashboard_summary_is_all_zero_for_an_empty_marketplace()
    {
        var summary = await new DashboardService(db).GetSummaryAsync();

        Assert.Equal(0, summary.TotalProducts.Value);
        Assert.Equal(0, summary.TotalApplications.Value);
        Assert.Equal(0, summary.ConversionRate.Value);
        Assert.Equal(0, summary.TotalViews.Value);
    }

    [Fact]
    public async Task Product_status_counts_ignore_the_status_filter_but_honour_the_category()
    {
        var loans = await CatalogAsync(("Home Loan", "Active", DateTime.UtcNow), ("Car Loan", "Draft", DateTime.UtcNow));
        var cards = new Category { Name = "Cards", Slug = "cards", Status = "Active" };
        db.Add(cards);
        db.Products.Add(new Product { Name = "Gold Card", Code = "GC", CategoryId = cards.Id, ProductTypeId = loans.ProductTypeId, Status = "Active" });
        await db.SaveChangesAsync();
        var service = new ProductService(db, Audit(), new RankingConfigService(db, Audit()));

        var counts = await service.StatusCountsAsync(new ProductQueryDto { CategoryId = loans.CategoryId, Status = "Draft" });

        Assert.Equal([new StatusCountDto("Active", 1), new StatusCountDto("Draft", 1)], counts);
    }

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

    /// <summary>
    /// The catalogue list now loads only what a card shows instead of the full detail graph. Pinned so
    /// that narrowing the query can never silently drop something a card displays.
    /// </summary>
    [Fact]
    public async Task A_product_card_carries_its_card_fields_two_feature_tags_and_only_the_current_promotion()
    {
        var product = await CatalogAsync(("Home Loan", "Active", DateTime.UtcNow));
        var rate = new FieldDefinition { ProductTypeId = product.ProductTypeId, Key = "rate", Label = "Rate", DisplayOnCard = true, SortOrder = 1 };
        var hidden = new FieldDefinition { ProductTypeId = product.ProductTypeId, Key = "internal", Label = "Internal", DisplayOnCard = false, SortOrder = 2 };
        db.AddRange(rate, hidden);
        db.AddRange(
            new ProductFieldValue { ProductId = product.Id, FieldDefinitionId = rate.Id, Value = "3.5" },
            new ProductFieldValue { ProductId = product.Id, FieldDefinitionId = hidden.Id, Value = "secret" },
            new ProductBenefit { ProductId = product.Id, Title = "Third", SortOrder = 3 },
            new ProductBenefit { ProductId = product.Id, Title = "First", SortOrder = 1 },
            new ProductBenefit { ProductId = product.Id, Title = "Second", SortOrder = 2 },
            new Promotion { ProductId = product.Id, Title = "Expired", Status = "Active", StartDate = DateTime.UtcNow.AddDays(-20), EndDate = DateTime.UtcNow.AddDays(-10) },
            new Promotion { ProductId = product.Id, Title = "Current", Status = "Active", StartDate = DateTime.UtcNow.AddDays(-1), EndDate = DateTime.UtcNow.AddDays(10) });
        await db.SaveChangesAsync();
        var service = new ProductService(db, Audit(), new RankingConfigService(db, Audit()));

        var card = Assert.Single((await service.SearchAsync(new ProductQueryDto { PageSize = 10 })).Items);

        Assert.Equal(["Rate"], card.CardFields.Select(f => f.Label));
        Assert.Equal(["First", "Second"], card.FeatureTags);
        Assert.Equal("Current", card.ActivePromotion?.Title);
        Assert.Equal("Loans", card.CategoryName);
        Assert.Equal("Loan", card.ProductTypeName);
    }

    // ---------------------------------------------------------------- fixture

    private AuditLogService Audit() => new(db, new FixedAuditContext(), new RecordingHub(), new RecordingForwarder());

    /// <summary>A category and type with the given products; returns the first product.</summary>
    private async Task<Product> CatalogAsync(params (string Name, string Status, DateTime CreatedAt)[] products)
    {
        var category = new Category { Name = "Loans", Slug = "loans", Status = "Active" };
        var type = new ProductType { Name = "Loan", Code = "loan" };
        db.AddRange(category, type);
        var created = products.Select((p, i) => new Product
        {
            Name = p.Name, Code = $"P{i}", CategoryId = category.Id, ProductTypeId = type.Id, Status = p.Status, CreatedAt = p.CreatedAt,
        }).ToList();
        db.Products.AddRange(created);
        await db.SaveChangesAsync();
        return created[0];
    }
}
