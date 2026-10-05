using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Api.Data;
using ProductMarketplace.Api.Exceptions;
using ProductMarketplace.Api.Models.Dtos.Templates;
using ProductMarketplace.Api.Models.Entities;
using ProductMarketplace.Api.Models.Enums;
using ProductMarketplace.Api.Models.Json;
using ProductMarketplace.Api.Services;
using ProductMarketplace.Api.Tests.Fakes;

namespace ProductMarketplace.Api.Tests.Services;

public class TemplateFieldUsageValidationTests : IDisposable
{
    private readonly ProductMarketplaceDbContext db;
    private readonly TemplateService service;

    public TemplateFieldUsageValidationTests()
    {
        var options = new DbContextOptionsBuilder<ProductMarketplaceDbContext>()
            .UseInMemoryDatabase($"template-usages-{Guid.NewGuid()}")
            .Options;
        db = new ProductMarketplaceDbContext(options);
        service = new TemplateService(db, new FakeLogger<TemplateService>());
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public async Task GetFieldUsages_detects_fields_used_in_eligibility_and_scoring()
    {
        var templateId = Guid.NewGuid();
        var template = new ProductTemplate
        {
            Id = templateId,
            Name = "Personal Loan Application",
            Code = "PL_APP",
            FormSchema = new FormSchema
            {
                Sections =
                [
                    new FormSection
                    {
                        Id = "sec1",
                        Title = "Applicant Info",
                        Fields =
                        [
                            new FormField { Key = "age", Label = "Age", Type = "number" },
                            new FormField { Key = "income", Label = "Monthly Income", Type = "number" },
                            new FormField { Key = "notes", Label = "Notes", Type = "text" }
                        ]
                    }
                ]
            }
        };

        var product = new Product
        {
            Id = Guid.NewGuid(),
            TemplateId = templateId,
            Name = "Standard Personal Loan",
            Code = "PL_STD",
            Status = ProductStatus.ACTIVE,
            EligibilityRules = new EligibilityRulesConfig
            {
                EligibilityCriteria =
                [
                    new EligibilityCriterion
                    {
                        CriterionId = "AGE_LIMIT",
                        Field = "age",
                        Operator = "GREATER_THAN_OR_EQUAL",
                        Value = 21,
                        Enabled = true
                    }
                ]
            },
            ScoringRules = new ScoringRulesConfig
            {
                ScoringCategories =
                [
                    new ScoringCategory
                    {
                        Key = "FINANCIAL",
                        Label = "Financial Health",
                        ScoredFields =
                        [
                            new ScoredField
                            {
                                Key = "INCOME_SCORE",
                                FormField = "income",
                                Enabled = true
                            }
                        ]
                    }
                ]
            }
        };

        db.Templates.Add(template);
        db.Products.Add(product);
        await db.SaveChangesAsync();

        var usages = await service.GetFieldUsagesAsync(templateId);

        Assert.True(usages.ContainsKey("age"));
        Assert.Single(usages["age"]);
        Assert.Equal("Eligibility", usages["age"][0].RuleType);
        Assert.Equal("Standard Personal Loan", usages["age"][0].ProductName);

        Assert.True(usages.ContainsKey("income"));
        Assert.Single(usages["income"]);
        Assert.Equal("Scoring", usages["income"][0].RuleType);

        Assert.False(usages.ContainsKey("notes"));
    }

    [Fact]
    public async Task UpdateTemplate_allows_updating_template_retaining_in_use_fields()
    {
        var templateId = Guid.NewGuid();
        var template = new ProductTemplate
        {
            Id = templateId,
            Name = "Personal Loan Application",
            Code = "PL_APP",
            FormSchema = new FormSchema
            {
                Sections =
                [
                    new FormSection
                    {
                        Id = "sec1",
                        Title = "Applicant Info",
                        Fields =
                        [
                            new FormField { Key = "age", Label = "Age", Type = "number" },
                            new FormField { Key = "income", Label = "Monthly Income", Type = "number" }
                        ]
                    }
                ]
            }
        };

        var product = new Product
        {
            Id = Guid.NewGuid(),
            TemplateId = templateId,
            Name = "Standard Personal Loan",
            Code = "PL_STD",
            EligibilityRules = new EligibilityRulesConfig
            {
                EligibilityCriteria =
                [
                    new EligibilityCriterion { Field = "age", Operator = "GREATER_THAN_OR_EQUAL", Value = 21 }
                ]
            }
        };

        db.Templates.Add(template);
        db.Products.Add(product);
        await db.SaveChangesAsync();

        var updated = await service.UpdateTemplateAsync(templateId, new UpdateTemplateRequest
        {
            Name = "Updated Loan App",
            FormSchema = new FormSchema
            {
                Sections =
                [
                    new FormSection
                    {
                        Id = "sec1",
                        Title = "Applicant Info",
                        Fields =
                        [
                            new FormField { Key = "age", Label = "Applicant Age", Type = "number" },
                            new FormField { Key = "new_field", Label = "New Field", Type = "text" }
                        ]
                    }
                ]
            }
        });

        Assert.Equal("Updated Loan App", updated.Name);
    }

    [Fact]
    public async Task UpdateTemplate_refuses_removing_field_used_in_eligibility_rules()
    {
        var templateId = Guid.NewGuid();
        var template = new ProductTemplate
        {
            Id = templateId,
            Name = "Personal Loan Application",
            Code = "PL_APP",
            FormSchema = new FormSchema
            {
                Sections =
                [
                    new FormSection
                    {
                        Id = "sec1",
                        Fields =
                        [
                            new FormField { Key = "age", Label = "Age", Type = "number" }
                        ]
                    }
                ]
            }
        };

        var product = new Product
        {
            Id = Guid.NewGuid(),
            TemplateId = templateId,
            Name = "Standard Personal Loan",
            Code = "PL_STD",
            EligibilityRules = new EligibilityRulesConfig
            {
                EligibilityCriteria =
                [
                    new EligibilityCriterion { Field = "age", Operator = "GREATER_THAN_OR_EQUAL", Value = 21 }
                ]
            }
        };

        db.Templates.Add(template);
        db.Products.Add(product);
        await db.SaveChangesAsync();

        var ex = await Assert.ThrowsAsync<ValidationException>(() => service.UpdateTemplateAsync(templateId, new UpdateTemplateRequest
        {
            Name = "Updated Loan App",
            FormSchema = new FormSchema
            {
                Sections =
                [
                    new FormSection
                    {
                        Id = "sec1",
                        Fields =
                        [
                            new FormField { Key = "salary", Label = "Salary", Type = "number" }
                        ]
                    }
                ]
            }
        }));

        Assert.Contains("age", ex.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Standard Personal Loan", ex.Message);
        Assert.Contains("Eligibility", ex.Message);
    }

    [Fact]
    public async Task UpdateTemplate_refuses_deactivating_field_used_in_scoring_rules()
    {
        var templateId = Guid.NewGuid();
        var template = new ProductTemplate
        {
            Id = templateId,
            Name = "Personal Loan Application",
            Code = "PL_APP",
            FormSchema = new FormSchema
            {
                Sections =
                [
                    new FormSection
                    {
                        Id = "sec1",
                        Fields =
                        [
                            new FormField { Key = "age", Label = "Age", Type = "number" }
                        ]
                    }
                ]
            }
        };

        var product = new Product
        {
            Id = Guid.NewGuid(),
            TemplateId = templateId,
            Name = "Standard Personal Loan",
            Code = "PL_STD",
            ScoringRules = new ScoringRulesConfig
            {
                ScoringCategories =
                [
                    new ScoringCategory
                    {
                        Key = "DEMOGRAPHIC",
                        Label = "Demographics",
                        ScoredFields = [new ScoredField { FormField = "age", Enabled = true }]
                    }
                ]
            }
        };

        db.Templates.Add(template);
        db.Products.Add(product);
        await db.SaveChangesAsync();

        // Field is still present but IsActive = false
        var ex = await Assert.ThrowsAsync<ValidationException>(() => service.UpdateTemplateAsync(templateId, new UpdateTemplateRequest
        {
            Name = "Updated Loan App",
            FormSchema = new FormSchema
            {
                Sections =
                [
                    new FormSection
                    {
                        Id = "sec1",
                        Fields =
                        [
                            new FormField { Key = "age", Label = "Age", Type = "number", IsActive = false }
                        ]
                    }
                ]
            }
        }));

        Assert.Contains("age", ex.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Scoring", ex.Message);
    }
}
