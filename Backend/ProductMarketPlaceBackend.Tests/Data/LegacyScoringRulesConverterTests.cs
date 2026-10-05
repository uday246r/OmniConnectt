using System.Text.Json;
using ProductMarketplace.Api.Data.Json;
using ProductMarketplace.Api.Models.Json;

namespace ProductMarketplace.Api.Tests.Data;

/// <summary>
/// Covers reading the original flat scoring shape and upgrading it to factors and criteria.
/// </summary>
/// <remarks>
/// Worth testing carefully because a wrong upgrade is destructive in a quiet way: the rules still look
/// present, but a maximum computed against the wrong mode changes every normalized score a product
/// produces. The payloads below are taken from real rows in this database rather than invented, so the
/// cases that matter are the ones the data actually contains.
/// </remarks>
public class LegacyScoringRulesConverterTests
{
    private static ScoringRulesConfig Read(string json) =>
        JsonSerializer.Deserialize<ScoringRulesConfig>(json, ScoringRulesJsonOptions.Value)!;

    [Fact]
    public void Two_exclusive_bands_on_one_field_become_a_single_banded_criterion()
    {
        // The Platinum card's real stored shape. Summing these gives a maximum of 50 that no applicant can
        // reach; read as one banded criterion the maximum is 30, which is the truth.
        var config = Read("""
        {
          "rules": [
            { "ruleId": "SCR_001", "category": "Financial Health", "field": "monthly_income",
              "operator": "GREATER_THAN_OR_EQUAL", "value": 10000, "points": 30 },
            { "ruleId": "SCR_002", "category": "Financial Health", "field": "monthly_income",
              "operator": "BETWEEN", "value": [5000, 9999], "points": 20 },
            { "ruleId": "SCR_003", "category": "Demographic Fit", "field": "employment_type",
              "operator": "EQUALS", "value": "SALARIED", "points": 20 }
          ]
        }
        """);

        Assert.Equal(2, config.ScoringCategories.Count);

        var financial = config.ScoringCategories.Single(f => f.Key == "FINANCIAL_HEALTH");
        Assert.Equal("Financial Health", financial.Label);

        var income = Assert.Single(financial.ScoredFields);
        Assert.Equal("MONTHLY_INCOME", income.Key);
        Assert.Equal("Monthly Income", income.Label);
        Assert.Equal("monthly_income", income.FormField);
        Assert.Equal(ScoringStyles.BestMatch, income.ScoringStyle);
        Assert.Equal(2, income.ScoreRanges.Count);
        Assert.True(income.Migrated);

        var demographic = config.ScoringCategories.Single(f => f.Key == "DEMOGRAPHIC_FIT");
        var employment = Assert.Single(demographic.ScoredFields);
        Assert.Equal(ScoringStyles.SumOfMatches, employment.ScoringStyle);
    }

    [Fact]
    public void Two_different_fields_in_one_category_become_two_criteria_that_both_count()
    {
        // The Home Loan product's real shape: income and age both under Financial Health. These are
        // independent, so the factor is worth 65 and both criteria are ADDITIVE with one rule each.
        var config = Read("""
        {
          "rules": [
            { "ruleId": "SCR_1", "category": "Financial Health", "field": "monthly_income",
              "operator": "GREATER_THAN_OR_EQUAL", "value": 5000, "points": 30 },
            { "ruleId": "SCR_2", "category": "Financial Health", "field": "age",
              "operator": "GREATER_THAN_OR_EQUAL", "value": 21, "points": 35 }
          ]
        }
        """);

        var factor = Assert.Single(config.ScoringCategories);
        Assert.Equal(2, factor.ScoredFields.Count);
        Assert.All(factor.ScoredFields, c => Assert.Equal(ScoringStyles.SumOfMatches, c.ScoringStyle));
        Assert.Equal(["MONTHLY_INCOME", "AGE"], factor.ScoredFields.Select(c => c.Key));
    }

    [Fact]
    public void A_lowercase_category_still_produces_a_usable_key_and_a_readable_label()
    {
        // The Education Loan product stores lowercase category names, unlike every other product. Keys are
        // what a consumer configures weights against, so they have to be stable regardless of casing.
        var config = Read("""
        {
          "rules": [
            { "ruleId": "R1", "category": "income", "field": "monthly_income",
              "operator": "GREATER_THAN_OR_EQUAL", "value": 1000, "points": 30 },
            { "ruleId": "R2", "category": "age", "field": "age", "operator": "BETWEEN",
              "value": [18, 30], "points": 25 }
          ]
        }
        """);

        Assert.Equal(["INCOME", "AGE"], config.ScoringCategories.Select(f => f.Key));
        Assert.Equal(["income", "age"], config.ScoringCategories.Select(f => f.Label));
    }

    [Fact]
    public void A_rule_with_no_category_is_collected_under_General()
    {
        var config = Read("""
        { "rules": [ { "ruleId": "R1", "field": "age", "operator": "GREATER_THAN", "value": 18, "points": 5 } ] }
        """);

        var factor = Assert.Single(config.ScoringCategories);
        Assert.Equal("GENERAL", factor.Key);
        Assert.Equal("General", factor.Label);
    }

    [Fact]
    public void The_previous_names_are_read_into_the_current_ones_and_not_marked_migrated()
    {
        var config = Read("""
        {
          "factors": [
            { "key": "DEMOGRAPHIC_FIT", "label": "Demographic Fit",
              "criteria": [
                { "key": "AGE", "label": "Age", "field": "age", "mode": "ADDITIVE",
                  "rules": [ { "ruleId": "SCR_1", "label": "25-40", "operator": "BETWEEN", "value": [25, 40], "points": 30 } ] }
              ] }
          ]
        }
        """);

        var criterion = Assert.Single(Assert.Single(config.ScoringCategories).ScoredFields);
        Assert.Equal(ScoringStyles.SumOfMatches, criterion.ScoringStyle);
        Assert.False(criterion.Migrated);
        Assert.Equal("25-40", Assert.Single(criterion.ScoreRanges).Label);
    }

    [Fact]
    public void A_model_already_in_the_current_shape_is_read_untouched()
    {
        var config = Read("""
        {
          "scoringCategories": [
            { "key": "DEMOGRAPHIC_FIT", "label": "Demographic Fit",
              "scoredFields": [
                { "key": "AGE", "label": "Age", "formField": "age",
                  "scoringStyle": "SUM_OF_MATCHES", "enabled": false,
                  "scoreRanges": [ { "rangeId": "SCR_1", "label": "25-40", "operator": "BETWEEN", "value": [25, 40], "points": 30 } ] }
              ] }
          ]
        }
        """);

        var scoredField = Assert.Single(Assert.Single(config.ScoringCategories).ScoredFields);
        Assert.Equal("age", scoredField.FormField);
        Assert.Equal(ScoringStyles.SumOfMatches, scoredField.ScoringStyle);
        Assert.False(scoredField.Enabled);
        Assert.False(scoredField.Migrated);
    }

    [Fact]
    public void A_scored_field_stored_before_the_enabled_flag_existed_still_counts()
    {
        // Guards the `= true` initializer. With a bare bool every field written before the flag
        // existed would read as disabled, and every product would score zero out of zero.
        var config = Read("""
        {
          "scoringCategories": [
            { "key": "K", "label": "K", "scoredFields": [ { "key": "F", "formField": "f", "scoreRanges": [] } ] }
          ]
        }
        """);

        Assert.True(Assert.Single(Assert.Single(config.ScoringCategories).ScoredFields).Enabled);
    }

    [Theory]
    [InlineData("BANDED", "BEST_MATCH")]
    [InlineData("ADDITIVE", "SUM_OF_MATCHES")]
    [InlineData("additive", "SUM_OF_MATCHES")]
    [InlineData("NONSENSE", "BEST_MATCH")]
    [InlineData(null, "BEST_MATCH")]
    public void The_original_style_spellings_are_accepted_permanently(string? stored, string expected)
    {
        // Not transitional: a database restored from an older backup, or a row written by a service
        // that predates the rename, still has to score correctly without a sweep having run.
        Assert.Equal(expected, ScoringStyles.Normalize(stored));
    }

    [Fact]
    public void The_current_shape_wins_when_a_row_somehow_carries_both()
    {
        var config = Read("""
        {
          "rules": [ { "ruleId": "OLD", "category": "Legacy", "field": "age", "operator": "EQUALS", "value": 1, "points": 99 } ],
          "factors": [ { "key": "NEW", "label": "New", "criteria": [] } ]
        }
        """);

        Assert.Equal("NEW", Assert.Single(config.ScoringCategories).Key);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("""{ "rules": [] }""")]
    [InlineData("""{ "factors": [] }""")]
    [InlineData("null")]
    public void An_empty_or_absent_model_reads_as_no_factors_rather_than_throwing(string json)
    {
        var config = JsonSerializer.Deserialize<ScoringRulesConfig>(json, ScoringRulesJsonOptions.Value);

        Assert.Empty(config?.ScoringCategories ?? []);
    }

    [Fact]
    public void An_upgraded_model_serializes_back_in_the_current_shape_only()
    {
        // This is what makes the upgrade stick: the next save writes factors, so the row stops being legacy.
        var config = Read("""
        { "rules": [ { "ruleId": "R1", "category": "Income", "field": "monthly_income",
                       "operator": "GREATER_THAN_OR_EQUAL", "value": 5000, "points": 20 } ] }
        """);

        var json = JsonSerializer.Serialize(config, ScoringRulesJsonOptions.Value);

        Assert.Contains("\"scoringCategories\"", json);
        Assert.DoesNotContain("\"factors\"", json);
        Assert.DoesNotContain("\"category\"", json);
        Assert.Contains("\"migrated\":true", json);
    }

    [Fact]
    public void A_migrated_flag_disappears_from_the_payload_once_it_is_cleared()
    {
        var config = Read("""
        { "rules": [ { "ruleId": "R1", "category": "Income", "field": "monthly_income",
                       "operator": "GREATER_THAN_OR_EQUAL", "value": 5000, "points": 20 } ] }
        """);

        config.ScoringCategories[0].ScoredFields[0].Migrated = false;

        Assert.DoesNotContain("migrated", JsonSerializer.Serialize(config, ScoringRulesJsonOptions.Value));
    }

    [Fact]
    public void A_rule_value_survives_the_upgrade_as_a_comparable_value_not_a_disposed_json_element()
    {
        // The JsonDocument backing a read is disposed when the read ends, so holding a JsonElement would
        // hand the engine a value that throws the moment it is compared. Values must be materialized.
        var config = Read("""
        { "rules": [
            { "ruleId": "R1", "category": "C", "field": "f1", "operator": "BETWEEN", "value": [5000, 9999], "points": 20 },
            { "ruleId": "R2", "category": "C", "field": "f2", "operator": "IN", "value": ["A", "B"], "points": 10 },
            { "ruleId": "R3", "category": "C", "field": "f3", "operator": "EQUALS", "value": true, "points": 5 },
            { "ruleId": "R4", "category": "C", "field": "f4", "operator": "GREATER_THAN", "value": 12.5, "points": 5 }
          ] }
        """);

        var rules = Assert.Single(config.ScoringCategories).ScoredFields.Select(c => Assert.Single(c.ScoreRanges)).ToList();

        Assert.Equal(new List<object?> { 5000L, 9999L }, Assert.IsType<List<object?>>(rules[0].Value));
        Assert.Equal(new List<object?> { "A", "B" }, Assert.IsType<List<object?>>(rules[1].Value));
        Assert.Equal(true, rules[2].Value);
        Assert.Equal(12.5m, rules[3].Value);
    }

    [Theory]
    [InlineData("monthly_income", "MONTHLY_INCOME")]
    [InlineData("monthlyIncome", "MONTHLY_INCOME")]
    [InlineData("Monthly Income", "MONTHLY_INCOME")]
    [InlineData("Financial Health", "FINANCIAL_HEALTH")]
    [InlineData("  spaced  out  ", "SPACED_OUT")]
    [InlineData("", "GENERAL")]
    public void A_key_is_derived_as_upper_snake_case(string input, string expected)
    {
        Assert.Equal(expected, LegacyScoringRulesConverter.ToUpperSnake(input));
    }
}
