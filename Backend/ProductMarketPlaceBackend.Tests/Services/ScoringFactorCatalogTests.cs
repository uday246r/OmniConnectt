using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Api.Data;
using ProductMarketplace.Api.Models.Entities;
using ProductMarketplace.Api.Models.Enums;
using ProductMarketplace.Api.Models.Json;
using ProductMarketplace.Api.Services;
using ProductMarketplace.Api.Services.Currency;
using ProductMarketplace.Api.Services.Evaluation;
using ProductMarketplace.Api.Tests.Fakes;

namespace ProductMarketplace.Api.Tests.Services;

/// <summary>
/// Covers the scoring-factor catalog the lead-management application configures its weights from.
/// </summary>
/// <remarks>
/// Worth testing because the consumer's weights are keyed on what this returns. Two failure modes matter:
/// including a factor no live product produces would dilute every real weight, and reporting one key under
/// two spellings would put the same factor in a weight editor twice — so the label conflict has to be
/// surfaced explicitly rather than resolved silently.
/// <para>
/// EF InMemory is used because this method loads entities and walks their jsonb in memory; the value
/// converters DO run on InMemory, so the round-trip through the scoring model is real.
/// </para>
/// </remarks>
public class ScoringFactorCatalogTests : IDisposable
{
    private readonly ProductMarketplaceDbContext db;

    public ScoringFactorCatalogTests()
    {
        var options = new DbContextOptionsBuilder<ProductMarketplaceDbContext>()
            .UseInMemoryDatabase($"scoring-factor-catalog-{Guid.NewGuid()}")
            .Options;
        db = new ProductMarketplaceDbContext(options);
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    private ProductService NewService() =>
        new(db,
            new RuleEvaluationEngine(new FakeLogger<RuleEvaluationEngine>()),
            new CurrencyService(db, new FakeLogger<CurrencyService>()),
            new FakeLogger<ProductService>());

    private static ScoringRulesConfig Model(params (string Key, string Label, string CriterionKey)[] factors) => new()
    {
        ScoringCategories = [.. factors.Select(f => new ScoringCategory
        {
            Key = f.Key,
            Label = f.Label,
            ScoredFields =
            [
                new ScoredField
                {
                    Key = f.CriterionKey,
                    Label = f.CriterionKey,
                    FormField = f.CriterionKey.ToLowerInvariant(),
                    ScoringStyle = ScoringStyles.BestMatch,
                    ScoreRanges = [new ScoreRange { RangeId = "SCR_1", Operator = "GREATER_THAN_OR_EQUAL", Value = 1, Points = 10 }]
                }
            ]
        })]
    };

    private async Task SeedProductAsync(string name, string code, ProductStatus status, ScoringRulesConfig scoring)
    {
        var category = new ProductCategory { Name = "Cat", Code = $"CAT_{code}" };
        var template = new ProductTemplate { Name = "T", Code = $"T_{code}", FormSchema = new FormSchema() };
        var workflow = new Workflow { Name = "W", Code = $"W_{code}", Steps = new WorkflowStepsConfig() };

        db.Categories.Add(category);
        db.Templates.Add(template);
        db.Workflows.Add(workflow);

        db.Products.Add(new Product
        {
            Name = name,
            Code = code,
            Status = status,
            CategoryId = category.Id,
            TemplateId = template.Id,
            WorkflowId = workflow.Id,
            ScoringRules = scoring
        });

        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task A_factor_used_by_several_products_is_reported_once_with_a_product_count()
    {
        await SeedProductAsync("Platinum", "PC_PLAT", ProductStatus.ACTIVE,
            Model(("DEMOGRAPHIC_FIT", "Demographic Fit", "EMPLOYMENT_TYPE")));
        await SeedProductAsync("Gold", "PC_GOLD", ProductStatus.ACTIVE,
            Model(("DEMOGRAPHIC_FIT", "Demographic Fit", "AGE")));

        var catalog = await NewService().GetScoringCategoryCatalogAsync();

        var factor = Assert.Single(catalog.ScoringCategories);
        Assert.Equal("DEMOGRAPHIC_FIT", factor.Key);
        Assert.Equal(2, factor.ProductCount);

        // Criteria are unioned across products, so the consumer can see what the factor actually measures.
        // Order is not meaningful here — it follows whichever product the service happened to read first.
        Assert.Equal(["AGE", "EMPLOYMENT_TYPE"], factor.ScoredFieldKeys.OrderBy(k => k, StringComparer.Ordinal));
        Assert.Equal(["Gold", "Platinum"], factor.UsedByProducts.Select(p => p.Name).OrderBy(n => n));
    }

    [Fact]
    public async Task A_factor_that_exists_only_on_a_non_active_product_is_excluded()
    {
        // Weighting a factor no live product produces would silently dilute every real factor.
        await SeedProductAsync("Live", "LIVE", ProductStatus.ACTIVE,
            Model(("FINANCIAL_HEALTH", "Financial Health", "MONTHLY_INCOME")));
        await SeedProductAsync("Draft", "DRAFT_ONE", ProductStatus.DRAFT,
            Model(("EXPERIMENTAL", "Experimental", "SOMETHING")));

        var catalog = await NewService().GetScoringCategoryCatalogAsync();

        Assert.Equal(["FINANCIAL_HEALTH"], catalog.ScoringCategories.Select(f => f.Key));
    }

    [Fact]
    public async Task One_key_spelled_differently_across_products_is_reported_as_a_conflict()
    {
        // Real data in this database does exactly this: "Location" on one product, "location" on another.
        await SeedProductAsync("Personal Loan", "P_LOAN", ProductStatus.ACTIVE,
            Model(("LOCATION", "Location", "LOCATION")));
        await SeedProductAsync("Education Loan", "EDU", ProductStatus.ACTIVE,
            Model(("LOCATION", "location", "LOCATION")));

        var catalog = await NewService().GetScoringCategoryCatalogAsync();

        // One entry, not two — the weight editor must not show the same factor twice.
        var factor = Assert.Single(catalog.ScoringCategories);
        Assert.Equal(2, factor.ProductCount);

        var conflict = Assert.Single(catalog.Conflicts);
        Assert.Equal("LOCATION", conflict.Key);
        Assert.Equal(["Location", "location"], conflict.Labels);
    }

    [Fact]
    public async Task A_key_spelled_consistently_produces_no_conflict()
    {
        await SeedProductAsync("A", "A", ProductStatus.ACTIVE, Model(("RISK", "Risk", "C1")));
        await SeedProductAsync("B", "B", ProductStatus.ACTIVE, Model(("RISK", "Risk", "C2")));

        var catalog = await NewService().GetScoringCategoryCatalogAsync();

        Assert.Empty(catalog.Conflicts);
    }

    [Fact]
    public async Task The_most_common_spelling_becomes_the_reported_label()
    {
        // One product's typo must not rename the factor for everyone, though the disagreement still shows.
        await SeedProductAsync("A", "A", ProductStatus.ACTIVE, Model(("RISK", "Risk Profile", "C1")));
        await SeedProductAsync("B", "B", ProductStatus.ACTIVE, Model(("RISK", "Risk Profile", "C2")));
        await SeedProductAsync("C", "C", ProductStatus.ACTIVE, Model(("RISK", "risk profile", "C3")));

        var catalog = await NewService().GetScoringCategoryCatalogAsync();

        Assert.Equal("Risk Profile", Assert.Single(catalog.ScoringCategories).Label);
        Assert.Single(catalog.Conflicts);
    }

    [Fact]
    public async Task Factors_are_ordered_by_how_widely_they_are_used()
    {
        await SeedProductAsync("A", "A", ProductStatus.ACTIVE, Model(("COMMON", "Common", "C1")));
        await SeedProductAsync("B", "B", ProductStatus.ACTIVE, Model(("COMMON", "Common", "C1")));
        await SeedProductAsync("C", "C", ProductStatus.ACTIVE, Model(("RARE", "Rare", "C2")));

        var catalog = await NewService().GetScoringCategoryCatalogAsync();

        Assert.Equal(["COMMON", "RARE"], catalog.ScoringCategories.Select(f => f.Key));
    }

    [Fact]
    public async Task An_empty_catalog_is_returned_rather_than_null_when_nothing_scores()
    {
        await SeedProductAsync("Unscored", "UNSCORED", ProductStatus.ACTIVE, new ScoringRulesConfig());

        var catalog = await NewService().GetScoringCategoryCatalogAsync();

        Assert.Empty(catalog.ScoringCategories);
        Assert.Empty(catalog.Conflicts);
    }
}
