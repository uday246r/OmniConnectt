using ProductMarketplace.Api.Models.Entities;
using ProductMarketplace.Api.Models.Json;
using ProductMarketplace.Api.Services.Evaluation;
using ProductMarketplace.Api.Tests.Fakes;

namespace ProductMarketplace.Api.Tests.Services.Evaluation;

/// <summary>
/// Covers multi-choice (checkbox group) fields, retired (inactive) fields, and per-rule validation
/// messages with date bounds.
/// </summary>
/// <remarks>
/// Each is a place where the authoring screen and the engine must agree or the form lies. A checkbox
/// group posts an array, so an options check that stringifies the whole answer rejects every valid
/// selection. An inactive field is retired, not deleted, so it must stop being demanded, checked and
/// scored without the engine growing a second "not asked" path. And a date's Min/Max was stored in a
/// decimal slot that can never read a date, so it silently did nothing.
/// </remarks>
public class RuleEvaluationEngineFieldTypeTests
{
    private static RuleEvaluationEngine NewEngine() => new(new FakeLogger<RuleEvaluationEngine>());

    private static Product ProductWith(params FormField[] fields) => new()
    {
        Name = "P",
        Code = "P_01",
        Template = new ProductTemplate
        {
            Name = "T",
            Code = "T",
            FormSchema = new FormSchema { Sections = [new FormSection { Id = "s", Title = "S", Order = 1, Fields = [.. fields] }] }
        },
        EligibilityRules = new EligibilityRulesConfig(),
        ScoringRules = new ScoringRulesConfig()
    };

    private static FormField Interests(bool required = false) => new()
    {
        Key = "interests",
        Label = "Interests",
        Type = "multiselect",
        Required = required,
        Options =
        [
            new FieldOption { Label = "Travel", Value = "TRAVEL" },
            new FieldOption { Label = "Dining", Value = "DINING" },
            new FieldOption { Label = "Fuel", Value = "FUEL" },
        ]
    };

    // ── multiselect ──────────────────────────────────────────────────────────────

    [Fact]
    public void A_multiselect_answer_with_every_choice_valid_passes_validation()
    {
        var result = NewEngine().Evaluate(ProductWith(Interests()), new Dictionary<string, object?>
        {
            ["interests"] = new[] { "TRAVEL", "FUEL" }
        });

        Assert.True(result.IsFormValid);
        Assert.Empty(result.ValidationErrors);
    }

    [Fact]
    public void A_multiselect_answer_containing_an_unknown_choice_names_that_choice()
    {
        var result = NewEngine().Evaluate(ProductWith(Interests()), new Dictionary<string, object?>
        {
            ["interests"] = new[] { "TRAVEL", "GAMBLING" }
        });

        Assert.False(result.IsFormValid);
        var error = Assert.Single(result.ValidationErrors);
        Assert.Contains("GAMBLING", error, StringComparison.Ordinal);
    }

    [Fact]
    public void A_required_multiselect_with_nothing_ticked_is_reported_as_missing()
    {
        var result = NewEngine().Evaluate(ProductWith(Interests(required: true)), new Dictionary<string, object?>
        {
            ["interests"] = Array.Empty<string>()
        });

        Assert.False(result.IsFormValid);
        Assert.Contains(result.ValidationErrors, e => e.Contains("is required", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("CONTAINS", "TRAVEL", true)]
    [InlineData("CONTAINS", "travel", true)]
    [InlineData("CONTAINS", "DINING", false)]
    [InlineData("NOT_CONTAINS", "DINING", true)]
    [InlineData("NOT_CONTAINS", "TRAVEL", false)]
    public void Contains_asks_whether_the_answer_list_includes_one_choice(string op, string choice, bool passes)
    {
        var product = ProductWith(Interests());
        product.EligibilityRules = new EligibilityRulesConfig
        {
            EligibilityCriteria =
            [
                new EligibilityCriterion { CriterionId = "ELG_1", Field = "interests", Operator = op, Value = choice }
            ]
        };

        var result = NewEngine().Evaluate(product, new Dictionary<string, object?>
        {
            ["interests"] = new[] { "TRAVEL", "FUEL" }
        });

        Assert.Equal(passes, result.IsEligible);
    }

    // ── inactive fields ──────────────────────────────────────────────────────────

    [Fact]
    public void A_required_field_marked_inactive_is_not_demanded()
    {
        var retired = new FormField { Key = "old_question", Label = "Old question", Type = "text", Required = true, IsActive = false };

        var result = NewEngine().Evaluate(ProductWith(retired), new Dictionary<string, object?>());

        Assert.True(result.IsFormValid);
        Assert.Contains("old_question", result.HiddenFieldKeys);
    }

    [Fact]
    public void A_field_with_no_active_flag_in_stored_json_reads_as_active()
    {
        // Every template written before this property existed has no "isActive" key. Reading those as
        // inactive would blank out every form in the database.
        var field = System.Text.Json.JsonSerializer.Deserialize<FormField>("""{"key":"k","label":"L","type":"text","required":true}""")!;

        Assert.True(field.IsActive);
    }

    [Fact]
    public void An_inactive_flag_survives_a_json_round_trip()
    {
        var json = System.Text.Json.JsonSerializer.Serialize(new FormField { Key = "k", IsActive = false });
        var back = System.Text.Json.JsonSerializer.Deserialize<FormField>(json)!;

        Assert.False(back.IsActive);
    }

    // ── per-rule messages and date bounds ────────────────────────────────────────

    [Fact]
    public void A_per_rule_message_is_preferred_over_the_whole_field_message()
    {
        var field = new FormField
        {
            Key = "code", Label = "Code", Type = "text",
            Validation = new FieldValidation
            {
                MinLength = 5,
                CustomMessage = "Legacy whole-field message.",
                Messages = new() { ["minLength"] = "Use at least 5 characters." }
            }
        };

        var result = NewEngine().Evaluate(ProductWith(field), new Dictionary<string, object?> { ["code"] = "ab" });

        Assert.Equal(["Use at least 5 characters."], result.ValidationErrors);
    }

    [Fact]
    public void The_whole_field_message_still_applies_when_a_rule_has_none_of_its_own()
    {
        var field = new FormField
        {
            Key = "code", Label = "Code", Type = "text",
            Validation = new FieldValidation { MinLength = 5, CustomMessage = "Legacy whole-field message." }
        };

        var result = NewEngine().Evaluate(ProductWith(field), new Dictionary<string, object?> { ["code"] = "ab" });

        Assert.Equal(["Legacy whole-field message."], result.ValidationErrors);
    }

    [Fact]
    public void Two_rules_on_one_field_each_report_their_own_message()
    {
        var field = new FormField
        {
            Key = "code", Label = "Code", Type = "text",
            Validation = new FieldValidation
            {
                MinLength = 5,
                Pattern = "^\\d+$",
                Messages = new() { ["minLength"] = "Too short.", ["format"] = "Digits only." }
            }
        };

        var result = NewEngine().Evaluate(ProductWith(field), new Dictionary<string, object?> { ["code"] = "ab" });

        Assert.Equal(["Too short.", "Digits only."], result.ValidationErrors);
    }

    [Theory]
    [InlineData("1985-06-01", true)]
    [InlineData("1999-12-31", true)]
    [InlineData("1949-12-31", false)]
    [InlineData("2001-01-01", false)]
    public void A_date_outside_the_authored_bounds_is_refused(string answer, bool valid)
    {
        var field = new FormField
        {
            Key = "dob", Label = "Date of birth", Type = "date",
            Validation = new FieldValidation { MinDate = "1950-01-01", MaxDate = "2000-12-31" }
        };

        var result = NewEngine().Evaluate(ProductWith(field), new Dictionary<string, object?> { ["dob"] = answer });

        Assert.Equal(valid, result.IsFormValid);
    }

    [Fact]
    public void A_field_carrying_only_legacy_validation_keys_validates_as_before()
    {
        var field = new FormField
        {
            Key = "pct", Label = "Percent", Type = "number",
            Validation = new FieldValidation { MinValue = 0, MaxValue = 100, CustomMessage = "Between 0 and 100." }
        };

        var bad = NewEngine().Evaluate(ProductWith(field), new Dictionary<string, object?> { ["pct"] = 150 });
        var good = NewEngine().Evaluate(ProductWith(field), new Dictionary<string, object?> { ["pct"] = 50 });

        Assert.Equal(["Between 0 and 100."], bad.ValidationErrors);
        Assert.True(good.IsFormValid);
    }
}
