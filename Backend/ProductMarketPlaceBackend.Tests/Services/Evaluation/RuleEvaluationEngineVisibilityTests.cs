using ProductMarketplace.Api.Models.Entities;
using ProductMarketplace.Api.Models.Json;
using ProductMarketplace.Api.Services.Evaluation;
using ProductMarketplace.Api.Tests.Fakes;

namespace ProductMarketplace.Api.Tests.Services.Evaluation;

/// <summary>
/// Covers visibility-aware validation, schema-typed coercion, and date comparison.
/// </summary>
/// <remarks>
/// All three were silent wrong answers rather than crashes, which is why they are worth pinning.
/// Visibility conditions were parsed but never evaluated, so an applicant was told a field they could
/// not see was required. Numeric fields arrive from a browser as strings, so a rule comparing them
/// against a number failed for everyone. And the ordering operators tried only a decimal conversion,
/// so every date rule — including the seeded "at least 21 years old" gate — quietly returned false.
/// </remarks>
public class RuleEvaluationEngineVisibilityTests
{
    private static RuleEvaluationEngine NewEngine() => new(new FakeLogger<RuleEvaluationEngine>());

    /// <summary>company_name is required, but only visible for SALARIED or SELF_EMPLOYED — the seeded shape.</summary>
    private static FormSchema ConditionalSchema() => new()
    {
        Sections =
        [
            new FormSection
            {
                Id = "financial_details",
                Title = "Financial Details",
                Order = 1,
                Fields =
                [
                    new FormField
                    {
                        Key = "employment_type",
                        Label = "Employment Type",
                        Type = "select",
                        Required = true,
                        Order = 1,
                        Options =
                        [
                            new FieldOption { Label = "Salaried", Value = "SALARIED" },
                            new FieldOption { Label = "Self Employed", Value = "SELF_EMPLOYED" },
                            new FieldOption { Label = "Retired", Value = "RETIRED" }
                        ]
                    },
                    new FormField
                    {
                        Key = "monthly_income",
                        Label = "Monthly Income",
                        Type = "currency",
                        Required = true,
                        Order = 2
                    },
                    new FormField
                    {
                        Key = "company_name",
                        Label = "Company Name",
                        Type = "text",
                        Required = true,
                        Order = 3,
                        Visibility = new VisibilityCondition
                        {
                            Field = "employment_type",
                            Operator = "IN",
                            Value = new[] { "SALARIED", "SELF_EMPLOYED" }
                        }
                    }
                ]
            }
        ]
    };

    private static Product ProductWith(FormSchema schema, EligibilityRulesConfig? eligibility = null) => new()
    {
        Name = "Conditional Product",
        Code = "COND_01",
        Template = new ProductTemplate { Name = "T", Code = "T", FormSchema = schema },
        EligibilityRules = eligibility ?? new EligibilityRulesConfig(),
        ScoringRules = new ScoringRulesConfig()
    };

    [Fact]
    public void A_required_field_hidden_by_its_visibility_condition_is_not_reported_as_missing()
    {
        var result = NewEngine().Evaluate(ProductWith(ConditionalSchema()), new Dictionary<string, object?>
        {
            ["employment_type"] = "RETIRED",
            ["monthly_income"] = 8000
        });

        Assert.True(result.IsFormValid);
        Assert.Empty(result.ValidationErrors);
        Assert.Equal(["company_name"], result.HiddenFieldKeys);
    }

    [Fact]
    public void A_required_field_that_is_visible_is_still_reported_as_missing()
    {
        var result = NewEngine().Evaluate(ProductWith(ConditionalSchema()), new Dictionary<string, object?>
        {
            ["employment_type"] = "SALARIED",
            ["monthly_income"] = 8000
        });

        Assert.False(result.IsFormValid);
        Assert.Contains(result.ValidationErrors, e => e.Contains("company_name", StringComparison.Ordinal));
        Assert.Empty(result.HiddenFieldKeys);
    }

    [Fact]
    public void A_field_whose_controller_was_left_blank_is_treated_as_hidden()
    {
        var result = NewEngine().Evaluate(ProductWith(ConditionalSchema()), new Dictionary<string, object?>
        {
            ["employment_type"] = "",
            ["monthly_income"] = 8000
        });

        Assert.Contains("company_name", result.HiddenFieldKeys);
    }

    [Fact]
    public void A_hidden_field_does_not_contribute_to_eligibility_even_if_a_stale_value_was_submitted()
    {
        // The applicant typed a company name, then switched to RETIRED. The browser hides the field but
        // keeps its value, so the stale value must not be able to satisfy a gate. An EQUALS rule on that
        // exact value is the only shape that isolates this: if the stale value leaked through the gate
        // would pass, and with the field excluded it resolves to null and fails.
        var eligibility = new EligibilityRulesConfig
        {
            EligibilityCriteria =
            [
                new EligibilityCriterion
                {
                    CriterionId = "ELG_001",
                    Field = "company_name",
                    Operator = "EQUALS",
                    Value = "Acme Holdings",
                    FailureMessage = "Employer must be Acme Holdings."
                }
            ]
        };

        var result = NewEngine().Evaluate(ProductWith(ConditionalSchema(), eligibility), new Dictionary<string, object?>
        {
            ["employment_type"] = "RETIRED",
            ["monthly_income"] = 8000,
            ["company_name"] = "Acme Holdings"
        });

        Assert.False(result.IsEligible);
    }

    [Fact]
    public void A_hidden_field_reads_as_absent_so_a_negative_operator_against_it_passes()
    {
        // Documents a consequence rather than endorsing it: excluding a hidden field makes it null, and
        // NOT_EQUALS/NOT_IN against null have always returned true. So a gate phrased negatively is
        // vacuously satisfied for applicants who never saw the field. That is pre-existing operator
        // semantics, not something visibility introduced — pinned here so a future change to either
        // shows up as a failure rather than a surprise in production.
        var eligibility = new EligibilityRulesConfig
        {
            EligibilityCriteria =
            [
                new EligibilityCriterion
                {
                    CriterionId = "ELG_001",
                    Field = "company_name",
                    Operator = "NOT_EQUALS",
                    Value = "",
                    FailureMessage = "Employer name is required."
                }
            ]
        };

        var result = NewEngine().Evaluate(ProductWith(ConditionalSchema(), eligibility), new Dictionary<string, object?>
        {
            ["employment_type"] = "RETIRED",
            ["monthly_income"] = 8000
        });

        Assert.True(result.IsEligible);
    }

    [Fact]
    public void A_field_with_no_visibility_condition_is_never_hidden()
    {
        var result = NewEngine().Evaluate(ProductWith(ConditionalSchema()), new Dictionary<string, object?>
        {
            ["employment_type"] = "SALARIED",
            ["monthly_income"] = 8000,
            ["company_name"] = "Acme"
        });

        Assert.True(result.IsFormValid);
        Assert.Empty(result.HiddenFieldKeys);
    }

    [Theory]
    [InlineData("8000")]
    [InlineData("RM 8,000")]
    [InlineData(8000)]
    public void A_currency_field_submitted_as_text_still_satisfies_a_numeric_gate(object submitted)
    {
        var schema = new FormSchema
        {
            Sections =
            [
                new FormSection
                {
                    Id = "s1", Title = "S", Order = 1,
                    Fields = [new FormField { Key = "monthly_income", Label = "Income", Type = "currency", Order = 1 }]
                }
            ]
        };

        var eligibility = new EligibilityRulesConfig
        {
            EligibilityCriteria = [new EligibilityCriterion { CriterionId = "ELG_001", Field = "monthly_income", Operator = "GREATER_THAN_OR_EQUAL", Value = 5000 }]
        };

        var result = NewEngine().Evaluate(ProductWith(schema, eligibility),
            new Dictionary<string, object?> { ["monthly_income"] = submitted });

        Assert.True(result.IsEligible);
    }

    [Theory]
    [InlineData("1990-01-01", true)]
    [InlineData("2015-06-30", false)]
    public void A_date_field_compares_as_a_date_rather_than_silently_failing(string dateOfBirth, bool expectedEligible)
    {
        var schema = new FormSchema
        {
            Sections =
            [
                new FormSection
                {
                    Id = "s1", Title = "S", Order = 1,
                    Fields = [new FormField { Key = "date_of_birth", Label = "Date of Birth", Type = "date", Order = 1 }]
                }
            ]
        };

        // "Born on or before 2005-01-01" is how an age floor is expressed as a date rule.
        var eligibility = new EligibilityRulesConfig
        {
            EligibilityCriteria = [new EligibilityCriterion { CriterionId = "ELG_AGE", Field = "date_of_birth", Operator = "LESS_THAN_OR_EQUAL", Value = "2005-01-01" }]
        };

        var result = NewEngine().Evaluate(ProductWith(schema, eligibility),
            new Dictionary<string, object?> { ["date_of_birth"] = dateOfBirth });

        Assert.Equal(expectedEligible, result.IsEligible);
    }

    /// <summary>
    /// EQUALS on a schema-typed date field — the coercion above turns the submission into a
    /// DateTimeOffset before this runs, and that object's default ToString() ("1/1/1990 12:00:00 AM
    /// +00:00") never equalled the plain "1990-01-01" an author types into the rule, so EQUALS rejected
    /// every applicant regardless of what date they gave, exactly like BETWEEN did below.
    /// </summary>
    [Theory]
    [InlineData("1990-01-01", true)]
    [InlineData("1990-01-02", false)]
    public void EQUALS_on_a_coerced_date_field_compares_as_a_date_rather_than_by_its_default_ToString(string dateOfBirth, bool expectedEligible)
    {
        var schema = new FormSchema
        {
            Sections =
            [
                new FormSection
                {
                    Id = "s1", Title = "S", Order = 1,
                    Fields = [new FormField { Key = "date_of_birth", Label = "Date of Birth", Type = "date", Order = 1 }]
                }
            ]
        };

        var eligibility = new EligibilityRulesConfig
        {
            EligibilityCriteria = [new EligibilityCriterion { CriterionId = "ELG_DOB", Field = "date_of_birth", Operator = "EQUALS", Value = "1990-01-01" }]
        };

        var result = NewEngine().Evaluate(ProductWith(schema, eligibility),
            new Dictionary<string, object?> { ["date_of_birth"] = dateOfBirth });

        Assert.Equal(expectedEligible, result.IsEligible);
    }

    /// <summary>Same coercion, for BETWEEN — the operator a "born between X and Y" age-range gate actually uses.</summary>
    [Theory]
    [InlineData("1995-06-15", true)]
    [InlineData("1959-12-31", false)]
    public void BETWEEN_on_a_coerced_date_field_compares_as_a_date_rather_than_by_decimal_conversion(string dateOfBirth, bool expectedEligible)
    {
        var schema = new FormSchema
        {
            Sections =
            [
                new FormSection
                {
                    Id = "s1", Title = "S", Order = 1,
                    Fields = [new FormField { Key = "date_of_birth", Label = "Date of Birth", Type = "date", Order = 1 }]
                }
            ]
        };

        var eligibility = new EligibilityRulesConfig
        {
            EligibilityCriteria = [new EligibilityCriterion { CriterionId = "ELG_DOB", Field = "date_of_birth", Operator = "BETWEEN", Value = new[] { "1960-01-01", "2007-12-31" } }]
        };

        var result = NewEngine().Evaluate(ProductWith(schema, eligibility),
            new Dictionary<string, object?> { ["date_of_birth"] = dateOfBirth });

        Assert.Equal(expectedEligible, result.IsEligible);
    }

    [Fact]
    public void A_plain_integer_is_never_reinterpreted_as_a_date()
    {
        // Guards the ordering of the temporal check: a bare year-like number must keep comparing
        // numerically, or every numeric threshold in the 1000-9999 range would change meaning.
        var eligibility = new EligibilityRulesConfig
        {
            EligibilityCriteria = [new EligibilityCriterion { CriterionId = "ELG_001", Field = "monthly_income", Operator = "GREATER_THAN", Value = 1999 }]
        };

        var product = new Product
        {
            Name = "P", Code = "P",
            EligibilityRules = eligibility,
            ScoringRules = new ScoringRulesConfig()
        };

        var result = NewEngine().Evaluate(product, new Dictionary<string, object?> { ["monthly_income"] = 2500 });

        Assert.True(result.IsEligible);
    }
}
