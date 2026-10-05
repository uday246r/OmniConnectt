using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Api.Data;
using ProductMarketplace.Api.Exceptions;
using ProductMarketplace.Api.Models.Dtos.Products;
using ProductMarketplace.Api.Models.Entities;
using ProductMarketplace.Api.Models.Json;
using ProductMarketplace.Api.Services;
using ProductMarketplace.Api.Services.Currency;
using ProductMarketplace.Api.Services.Evaluation;
using ProductMarketplace.Api.Tests.Fakes;

namespace ProductMarketplace.Api.Tests.Services;

/// <summary>
/// Covers the 100-point budget a scoring category may allocate.
/// </summary>
/// <remarks>
/// Every category is reported out of 100, so one that allocates more has ranges that cannot all be
/// reached together and a normalized score that means nothing. The editor blocks it, but a request that
/// skips the editor must be held to the same rule — and the total has to be computed the way the model
/// reports its own maximum, or the two would disagree about which categories are over.
/// </remarks>
public class ScoringBudgetValidationTests : IDisposable
{
    private readonly ProductMarketplaceDbContext db;
    private Guid categoryId, templateId, workflowId;

    public ScoringBudgetValidationTests()
    {
        var options = new DbContextOptionsBuilder<ProductMarketplaceDbContext>()
            .UseInMemoryDatabase($"scoring-budget-{Guid.NewGuid()}")
            .Options;
        db = new ProductMarketplaceDbContext(options);

        var category = new ProductCategory { Name = "Cat", Code = "CAT_B" };
        var template = new ProductTemplate { Name = "T", Code = "T_B", FormSchema = new FormSchema() };
        var workflow = new Workflow { Name = "W", Code = "W_B", Steps = new WorkflowStepsConfig() };
        db.Categories.Add(category);
        db.Templates.Add(template);
        db.Workflows.Add(workflow);
        db.SaveChanges();
        (categoryId, templateId, workflowId) = (category.Id, template.Id, workflow.Id);
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

    private static ScoredField Field(string key, bool enabled = true, params int[] rangePoints) => new()
    {
        Key = key,
        Label = key,
        FormField = key.ToLowerInvariant(),
        Enabled = enabled,
        ScoringStyle = ScoringStyles.BestMatch,
        ScoreRanges = [.. rangePoints.Select((p, i) => new ScoreRange
        {
            RangeId = $"{key}_{i}",
            Operator = "GREATER_THAN_OR_EQUAL",
            Value = i,
            Points = p,
        })]
    };

    private static ScoringRulesConfig Category(string label, params ScoredField[] fields) => new()
    {
        ScoringCategories = [new ScoringCategory { Key = label.ToUpperInvariant(), Label = label, ScoredFields = [.. fields] }]
    };

    private CreateProductRequest Request(ScoringRulesConfig scoring) => new()
    {
        CategoryId = categoryId,
        TemplateId = templateId,
        WorkflowId = workflowId,
        Name = "Budgeted",
        Code = $"BUD_{Guid.NewGuid():N}"[..12],
        ScoringRules = scoring,
    };

    private async Task<int> StoredMaxAsync(Guid productId)
    {
        var stored = await db.Products.AsNoTracking().SingleAsync(p => p.Id == productId);
        return ScoringMath.CategoryMaxPoints(stored.ScoringRules.ScoringCategories[0]);
    }

    [Fact]
    public async Task A_category_allocating_exactly_the_budget_is_accepted()
    {
        var created = await NewService().CreateProductAsync(Request(
            Category("Demographic", Field("AGE", true, 60), Field("INCOME", true, 40))));

        Assert.Equal(100, await StoredMaxAsync(created.Id));
    }

    [Fact]
    public async Task A_category_over_the_budget_is_refused_and_named_with_its_overage()
    {
        var ex = await Assert.ThrowsAsync<ValidationException>(() => NewService().CreateProductAsync(Request(
            Category("Demographic", Field("AGE", true, 60), Field("INCOME", true, 41)))));

        Assert.Contains("Demographic", ex.Message, StringComparison.Ordinal);
        Assert.Contains("101", ex.Message, StringComparison.Ordinal);
        Assert.Contains("1 over", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Alternative_ranges_on_one_field_count_once_so_they_cannot_push_a_category_over()
    {
        // Best-match ranges are alternatives: 60 and 70 on one field is a ceiling of 70, not 130.
        var created = await NewService().CreateProductAsync(Request(
            Category("Financial", Field("INCOME", true, 60, 70))));

        Assert.Equal(70, await StoredMaxAsync(created.Id));
    }

    [Fact]
    public async Task A_field_switched_off_does_not_count_toward_the_budget()
    {
        var created = await NewService().CreateProductAsync(Request(
            Category("Demographic", Field("AGE", true, 80), Field("OLD_RULE", enabled: false, 90))));

        Assert.Equal(80, await StoredMaxAsync(created.Id));
    }

    [Fact]
    public async Task Updating_a_product_to_an_over_budget_model_is_refused_and_leaves_the_stored_one_alone()
    {
        var service = NewService();
        var created = await service.CreateProductAsync(Request(Category("Demographic", Field("AGE", true, 50))));

        var update = new UpdateProductRequest
        {
            CategoryId = categoryId,
            TemplateId = templateId,
            WorkflowId = workflowId,
            Name = "Budgeted",
            ScoringRules = Category("Demographic", Field("AGE", true, 150)),
        };

        await Assert.ThrowsAsync<ValidationException>(() => service.UpdateProductAsync(created.Id, update));

        var stored = await db.Products.AsNoTracking().SingleAsync(p => p.Id == created.Id);
        Assert.Equal(50, ScoringMath.CategoryMaxPoints(stored.ScoringRules.ScoringCategories[0]));
    }

    [Fact]
    public async Task An_update_that_omits_the_scoring_model_is_not_checked_because_it_leaves_it_unchanged()
    {
        var service = NewService();
        var created = await service.CreateProductAsync(Request(Category("Demographic", Field("AGE", true, 50))));

        var update = new UpdateProductRequest
        {
            CategoryId = categoryId,
            TemplateId = templateId,
            WorkflowId = workflowId,
            Name = "Renamed",
            ScoringRules = null,
        };

        var updated = await service.UpdateProductAsync(created.Id, update);

        Assert.Equal("Renamed", updated.Name);
    }
}
