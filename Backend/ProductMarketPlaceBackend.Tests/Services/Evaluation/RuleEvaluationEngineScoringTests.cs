using ProductMarketplace.Api.Models.Entities;
using ProductMarketplace.Api.Models.Json;
using ProductMarketplace.Api.Services.Evaluation;
using ProductMarketplace.Api.Tests.Fakes;

namespace ProductMarketplace.Api.Tests.Services.Evaluation;

/// <summary>
/// Covers the factor/criterion scoring arithmetic and its normalization to 0-100.
/// </summary>
/// <remarks>
/// The most important surface in this service to test, because it is the only place doing real
/// arithmetic and a silently wrong answer here becomes a wrong lending decision rather than an error
/// anyone notices. The specific defect these guard against: with a flat rule list, two mutually
/// exclusive income bands worth 30 and 20 summed to a maximum of 50 that no applicant could ever
/// reach, so every normalized income score understated itself by a third.
/// <para>
/// Weights are intentionally absent everywhere below. This service reports each factor out of 100; the
/// consuming lead-management application holds the weights and the cold/warm/hot boundaries.
/// </para>
/// </remarks>
public class RuleEvaluationEngineScoringTests
{
    private static RuleEvaluationEngine NewEngine() => new(new FakeLogger<RuleEvaluationEngine>());

    private static Product ProductWith(ScoringRulesConfig scoring, Workflow? workflow = null) => new()
    {
        Name = "Scored Product",
        Code = "SCORE_01",
        EligibilityRules = new EligibilityRulesConfig(),
        ScoringRules = scoring,
        Workflow = workflow!
    };

    private static ScoreRange Rule(string id, string op, object? value, int points) => new()
    {
        RangeId = id,
        Operator = op,
        Value = value,
        Points = points
    };

    private static ScoringRulesConfig OneFactor(string mode, params ScoreRange[] rules) => new()
    {
        ScoringCategories =
        [
            new ScoringCategory
            {
                Key = "FINANCIAL_HEALTH",
                Label = "Financial Health",
                ScoredFields =
                [
                    new ScoredField
                    {
                        Key = "MONTHLY_INCOME",
                        Label = "Monthly Income",
                        FormField = "monthly_income",
                        ScoringStyle = mode,
                        ScoreRanges = [.. rules]
                    }
                ]
            }
        ]
    };

    // ------------------------------------------------------------------ BANDED

    [Fact]
    public void A_banded_criterion_awards_only_the_highest_matching_band()
    {
        // Both bands would "match" a 12,000 earner if evaluated independently: >= 10000 is true, and so
        // would any lower threshold be. Only the best one may score, and the maximum is 30, not 50.
        var product = ProductWith(OneFactor(ScoringStyles.BestMatch,
            Rule("SCR_001", "GREATER_THAN_OR_EQUAL", 10000, 30),
            Rule("SCR_002", "GREATER_THAN_OR_EQUAL", 5000, 20)));

        var result = NewEngine().Evaluate(product, new Dictionary<string, object?> { ["monthly_income"] = 12000 });

        var factor = Assert.Single(result.ScoringCategories);
        Assert.Equal(30, factor.EarnedPoints);
        Assert.Equal(30, factor.MaxPoints);
        Assert.Equal(100m, factor.NormalizedScore);

        var criterion = Assert.Single(factor.Criteria);
        var matched = Assert.Single(criterion.MatchedRules);
        Assert.Equal("SCR_001", matched.RuleId);
    }

    [Fact]
    public void A_banded_criterion_picks_the_best_band_regardless_of_the_order_they_were_authored_in()
    {
        // Guards against trusting the author's array order: listing the weaker band first must not make
        // it win.
        var product = ProductWith(OneFactor(ScoringStyles.BestMatch,
            Rule("SCR_LOW", "GREATER_THAN_OR_EQUAL", 5000, 20),
            Rule("SCR_HIGH", "GREATER_THAN_OR_EQUAL", 10000, 30)));

        var result = NewEngine().Evaluate(product, new Dictionary<string, object?> { ["monthly_income"] = 12000 });

        Assert.Equal("SCR_HIGH", Assert.Single(result.ScoringCategories[0].Criteria[0].MatchedRules).RuleId);
    }

    [Fact]
    public void A_banded_criterion_scores_the_lower_band_when_the_higher_one_does_not_match()
    {
        var product = ProductWith(OneFactor(ScoringStyles.BestMatch,
            Rule("SCR_001", "GREATER_THAN_OR_EQUAL", 10000, 30),
            Rule("SCR_002", "BETWEEN", new[] { 5000, 9999 }, 20)));

        var result = NewEngine().Evaluate(product, new Dictionary<string, object?> { ["monthly_income"] = 8000 });

        var factor = result.ScoringCategories[0];
        Assert.Equal(20, factor.EarnedPoints);
        Assert.Equal(30, factor.MaxPoints);
        Assert.Equal(66.67m, factor.NormalizedScore);
    }

    [Fact]
    public void A_banded_criterion_scores_zero_when_the_value_falls_outside_every_band()
    {
        var product = ProductWith(OneFactor(ScoringStyles.BestMatch,
            Rule("SCR_001", "GREATER_THAN_OR_EQUAL", 10000, 30)));

        var result = NewEngine().Evaluate(product, new Dictionary<string, object?> { ["monthly_income"] = 1000 });

        var criterion = result.ScoringCategories[0].Criteria[0];
        Assert.Equal(0, criterion.EarnedPoints);
        Assert.Equal(30, criterion.MaxPoints);
        Assert.Equal(0m, criterion.NormalizedScore);
        Assert.Empty(criterion.MatchedRules);
    }

    // ------------------------------------------------------------------ ADDITIVE

    [Fact]
    public void An_additive_criterion_sums_every_matching_rule_and_its_maximum_is_their_total()
    {
        var product = ProductWith(OneFactor(ScoringStyles.SumOfMatches,
            Rule("SCR_A", "GREATER_THAN_OR_EQUAL", 5000, 20),
            Rule("SCR_B", "GREATER_THAN_OR_EQUAL", 10000, 30)));

        var result = NewEngine().Evaluate(product, new Dictionary<string, object?> { ["monthly_income"] = 12000 });

        var factor = result.ScoringCategories[0];
        Assert.Equal(50, factor.EarnedPoints);
        Assert.Equal(50, factor.MaxPoints);
        Assert.Equal(2, factor.Criteria[0].MatchedRules.Count);
    }

    // ------------------------------------------------------------------ mode handling

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("banded")]
    [InlineData("SOMETHING_ELSE")]
    public void An_absent_or_unrecognised_mode_is_read_as_banded(string? mode)
    {
        // Mode lives in jsonb, so a typo or an older client's value must not throw and must not inflate a
        // maximum. Banded is the safe reading because it can only ever under-count.
        var product = ProductWith(OneFactor(mode!,
            Rule("SCR_A", "GREATER_THAN_OR_EQUAL", 5000, 20),
            Rule("SCR_B", "GREATER_THAN_OR_EQUAL", 10000, 30)));

        var result = NewEngine().Evaluate(product, new Dictionary<string, object?> { ["monthly_income"] = 12000 });

        Assert.Equal(ScoringStyles.BestMatch, result.ScoringCategories[0].Criteria[0].Mode);
        Assert.Equal(30, result.ScoringCategories[0].MaxPoints);
    }

    // ------------------------------------------------------------------ negatives and clamping

    [Fact]
    public void A_negative_rule_never_raises_the_maximum()
    {
        var product = ProductWith(OneFactor(ScoringStyles.SumOfMatches,
            Rule("SCR_BONUS", "GREATER_THAN_OR_EQUAL", 5000, 20),
            Rule("SCR_PENALTY", "LESS_THAN", 1000, -15)));

        var result = NewEngine().Evaluate(product, new Dictionary<string, object?> { ["monthly_income"] = 8000 });

        Assert.Equal(20, result.ScoringCategories[0].MaxPoints);
        Assert.Equal(20, result.ScoringCategories[0].EarnedPoints);
    }

    [Fact]
    public void A_penalty_can_cancel_a_bonus_but_cannot_drive_a_criterion_below_zero()
    {
        var product = ProductWith(OneFactor(ScoringStyles.SumOfMatches,
            Rule("SCR_BONUS", "GREATER_THAN_OR_EQUAL", 5000, 10),
            Rule("SCR_PENALTY", "GREATER_THAN_OR_EQUAL", 5000, -40)));

        var result = NewEngine().Evaluate(product, new Dictionary<string, object?> { ["monthly_income"] = 8000 });

        Assert.Equal(0, result.ScoringCategories[0].EarnedPoints);
        Assert.Equal(0m, result.ScoringCategories[0].NormalizedScore);
    }

    [Fact]
    public void A_criterion_made_only_of_penalties_normalizes_to_zero_rather_than_dividing_by_zero()
    {
        var product = ProductWith(OneFactor(ScoringStyles.SumOfMatches,
            Rule("SCR_PENALTY", "LESS_THAN", 1000, -15)));

        var result = NewEngine().Evaluate(product, new Dictionary<string, object?> { ["monthly_income"] = 500 });

        Assert.Equal(0, result.ScoringCategories[0].MaxPoints);
        Assert.Equal(0m, result.ScoringCategories[0].NormalizedScore);
        Assert.Equal(0m, result.UnweightedNormalizedScore);
    }

    // ------------------------------------------------------------------ the user's own example

    [Fact]
    public void A_factor_reports_its_own_score_out_of_100_independently_of_every_other_factor()
    {
        // Demographic Fit holds two sub-criteria worth 30 and 40 raw points. An applicant who earns the
        // 40 but not the 30 scores 40 of a possible 70 => 57.14 out of 100 for that factor. The consuming
        // application then applies its own weight to that percentage; nothing here knows the weight.
        var scoring = new ScoringRulesConfig
        {
            ScoringCategories =
            [
                new ScoringCategory
                {
                    Key = "DEMOGRAPHIC_FIT",
                    Label = "Demographic Fit",
                    ScoredFields =
                    [
                        new ScoredField
                        {
                            Key = "AGE", Label = "Age", FormField = "age", ScoringStyle = ScoringStyles.BestMatch,
                            ScoreRanges = [Rule("SCR_AGE", "BETWEEN", new[] { 25, 40 }, 30)]
                        },
                        new ScoredField
                        {
                            Key = "ANNUAL_INCOME", Label = "Annual Income", FormField = "annual_income",
                            ScoringStyle = ScoringStyles.BestMatch,
                            ScoreRanges = [Rule("SCR_INCOME", "GREATER_THAN_OR_EQUAL", 50000, 40)]
                        }
                    ]
                }
            ]
        };

        var result = NewEngine().Evaluate(ProductWith(scoring), new Dictionary<string, object?>
        {
            ["age"] = 50,
            ["annual_income"] = 80000
        });

        var factor = Assert.Single(result.ScoringCategories);
        Assert.Equal(40, factor.EarnedPoints);
        Assert.Equal(70, factor.MaxPoints);
        Assert.Equal(57.14m, factor.NormalizedScore);
    }

    [Fact]
    public void Each_factor_normalizes_against_its_own_maximum_not_the_product_total()
    {
        // The guard for the reason UnweightedNormalizedScore is named the way it is: with unequal maxima
        // the unweighted overall is NOT what equal weights would produce, so the two must not be confused.
        var scoring = new ScoringRulesConfig
        {
            ScoringCategories =
            [
                new ScoringCategory
                {
                    Key = "BIG", Label = "Big Factor",
                    ScoredFields =
                    [
                        new ScoredField
                        {
                            Key = "A", Label = "A", FormField = "a", ScoringStyle = ScoringStyles.BestMatch,
                            ScoreRanges = [Rule("SCR_A", "GREATER_THAN_OR_EQUAL", 1, 90)]
                        }
                    ]
                },
                new ScoringCategory
                {
                    Key = "SMALL", Label = "Small Factor",
                    ScoredFields =
                    [
                        new ScoredField
                        {
                            Key = "B", Label = "B", FormField = "b", ScoringStyle = ScoringStyles.BestMatch,
                            ScoreRanges = [Rule("SCR_B", "GREATER_THAN_OR_EQUAL", 1, 10)]
                        }
                    ]
                }
            ]
        };

        var result = NewEngine().Evaluate(ProductWith(scoring), new Dictionary<string, object?>
        {
            ["a"] = 5,
            ["b"] = 0
        });

        Assert.Equal(100m, result.ScoringCategories.Single(f => f.Key == "BIG").NormalizedScore);
        Assert.Equal(0m, result.ScoringCategories.Single(f => f.Key == "SMALL").NormalizedScore);

        // 90 of 100 raw points overall, while equal weights over the per-factor scores would give 50.
        Assert.Equal(90m, result.UnweightedNormalizedScore);
    }

    // ------------------------------------------------------------------ empty model

    [Fact]
    public void A_product_with_no_scoring_model_reports_zeroes_rather_than_failing()
    {
        var result = NewEngine().Evaluate(ProductWith(new ScoringRulesConfig()), new Dictionary<string, object?>());

        Assert.Empty(result.ScoringCategories);
        Assert.Equal(0, result.TotalEarnedPoints);
        Assert.Equal(0, result.TotalMaxPoints);
        Assert.Equal(0m, result.UnweightedNormalizedScore);
    }

    // ------------------------------------------------------------------ switching a field off

    /// <summary>
    /// The worked example this feature exists for: three fields worth 50, 25 and 25 in one category.
    /// </summary>
    private static ScoringRulesConfig ThreeFieldCategory(bool occupationEnabled) => new()
    {
        ScoringCategories =
        [
            new ScoringCategory
            {
                Key = "DEMOGRAPHIC_FIT",
                Label = "Demographic Fit",
                ScoredFields =
                [
                    new ScoredField
                    {
                        Key = "ANNUAL_INCOME", Label = "Annual Income", FormField = "annual_income",
                        ScoringStyle = ScoringStyles.BestMatch,
                        ScoreRanges = [Rule("R1", "GREATER_THAN_OR_EQUAL", 4000, 50)]
                    },
                    new ScoredField
                    {
                        Key = "AGE", Label = "Age", FormField = "age",
                        ScoringStyle = ScoringStyles.BestMatch,
                        ScoreRanges = [Rule("R2", "GREATER_THAN_OR_EQUAL", 21, 25)]
                    },
                    new ScoredField
                    {
                        Key = "OCCUPATION", Label = "Occupation", FormField = "occupation",
                        ScoringStyle = ScoringStyles.BestMatch,
                        Enabled = occupationEnabled,
                        ScoreRanges = [Rule("R3", "EQUALS", "DOCTOR", 25)]
                    }
                ]
            }
        ]
    };

    [Fact]
    public void All_three_fields_in_use_score_out_of_their_combined_total()
    {
        var result = NewEngine().Evaluate(ProductWith(ThreeFieldCategory(occupationEnabled: true)),
            new Dictionary<string, object?>
            {
                ["annual_income"] = 5000,
                ["age"] = 30,
                ["occupation"] = "TEACHER"
            });

        var category = Assert.Single(result.ScoringCategories);

        // Income and age match, occupation does not: 75 earned out of 100 possible.
        Assert.Equal(75, category.EarnedPoints);
        Assert.Equal(100, category.MaxPoints);
        Assert.Equal(75m, category.NormalizedScore);
    }

    [Fact]
    public void Switching_a_field_off_rescales_the_rest_against_what_remains()
    {
        // The same applicant, with Occupation taken out of use. It contributes neither its 25 earned
        // nor its 25 maximum, so the category is scored out of 75 — and the applicant who earns all of
        // what is left now reads 100 rather than 75. This is the whole point of the flag: a field can
        // be retired without re-pointing every other field in the category.
        var result = NewEngine().Evaluate(ProductWith(ThreeFieldCategory(occupationEnabled: false)),
            new Dictionary<string, object?>
            {
                ["annual_income"] = 5000,
                ["age"] = 30,
                ["occupation"] = "TEACHER"
            });

        var category = Assert.Single(result.ScoringCategories);

        Assert.Equal(75, category.EarnedPoints);
        Assert.Equal(75, category.MaxPoints);
        Assert.Equal(100m, category.NormalizedScore);
    }

    [Fact]
    public void A_field_that_is_switched_off_is_still_reported_so_the_change_is_visible()
    {
        var result = NewEngine().Evaluate(ProductWith(ThreeFieldCategory(occupationEnabled: false)),
            new Dictionary<string, object?> { ["occupation"] = "DOCTOR" });

        // Listed with zeroes rather than omitted: an operator comparing two evaluations needs to tell
        // "this field was switched off" apart from "this field was never configured".
        var occupation = Assert.Single(result.ScoringCategories[0].Criteria.Where(c => c.Key == "OCCUPATION"));
        Assert.False(occupation.Enabled);
        Assert.Equal(0, occupation.MaxPoints);
        Assert.Equal(0, occupation.EarnedPoints);

        // Even though the applicant's answer WOULD have matched its range.
        Assert.Empty(occupation.MatchedRules);
    }

    /// <summary>
    /// Demographic Fit scoring CGPA out of 20 and Location out of 10.
    /// </summary>
    /// <remarks>
    /// The raw points deliberately do not add to 100. What leaves this service is the normalized
    /// score, which is always out of 100 whatever the category happens to total — so a consumer
    /// weighting Demographic Fit never has to know that this product chose 30 and another chose 75.
    /// </remarks>
    private static ScoringRulesConfig CgpaAndLocation(bool locationEnabled) => new()
    {
        ScoringCategories =
        [
            new ScoringCategory
            {
                Key = "DEMOGRAPHIC_FIT",
                Label = "Demographic Fit",
                ScoredFields =
                [
                    new ScoredField
                    {
                        Key = "CGPA", Label = "CGPA", FormField = "cgpa",
                        ScoringStyle = ScoringStyles.BestMatch,
                        ScoreRanges = [Rule("R1", "GREATER_THAN_OR_EQUAL", 3, 20)]
                    },
                    new ScoredField
                    {
                        Key = "LOCATION", Label = "Location", FormField = "location",
                        ScoringStyle = ScoringStyles.BestMatch,
                        Enabled = locationEnabled,
                        ScoreRanges = [Rule("R2", "EQUALS", "Malaysia", 10)]
                    }
                ]
            }
        ]
    };

    [Fact]
    public void Twenty_plus_ten_is_reported_out_of_one_hundred_not_out_of_thirty()
    {
        var result = NewEngine().Evaluate(ProductWith(CgpaAndLocation(locationEnabled: true)),
            new Dictionary<string, object?> { ["cgpa"] = 3.5m, ["location"] = "Malaysia" });

        var category = Assert.Single(result.ScoringCategories);

        // The raw arithmetic is still visible for explaining a decision...
        Assert.Equal(30, category.EarnedPoints);
        Assert.Equal(30, category.MaxPoints);

        // ...but the number a consumer weights is out of 100.
        Assert.Equal(100m, category.NormalizedScore);
    }

    [Fact]
    public void Earning_only_the_cgpa_half_reports_two_thirds_of_one_hundred()
    {
        var result = NewEngine().Evaluate(ProductWith(CgpaAndLocation(locationEnabled: true)),
            new Dictionary<string, object?> { ["cgpa"] = 3.5m, ["location"] = "Singapore" });

        var category = Assert.Single(result.ScoringCategories);

        Assert.Equal(20, category.EarnedPoints);
        Assert.Equal(30, category.MaxPoints);
        Assert.Equal(66.67m, category.NormalizedScore);
    }

    [Fact]
    public void Removing_location_leaves_cgpa_scored_out_of_one_hundred_on_its_own()
    {
        // Only CGPA remains, worth 20. An applicant who earns it scores 100 — not 20, and not 66.67.
        // Nothing else in the category has to be re-pointed for that to hold.
        var result = NewEngine().Evaluate(ProductWith(CgpaAndLocation(locationEnabled: false)),
            new Dictionary<string, object?> { ["cgpa"] = 3.5m, ["location"] = "Malaysia" });

        var category = Assert.Single(result.ScoringCategories);

        Assert.Equal(20, category.EarnedPoints);
        Assert.Equal(20, category.MaxPoints);
        Assert.Equal(100m, category.NormalizedScore);
    }

    [Fact]
    public void A_category_whose_fields_are_all_switched_off_scores_zero_rather_than_dividing_by_zero()
    {
        var config = ThreeFieldCategory(occupationEnabled: false);
        foreach (var field in config.ScoringCategories[0].ScoredFields)
        {
            field.Enabled = false;
        }

        var result = NewEngine().Evaluate(ProductWith(config), new Dictionary<string, object?>
        {
            ["annual_income"] = 5000,
            ["age"] = 30
        });

        var category = Assert.Single(result.ScoringCategories);
        Assert.Equal(0, category.MaxPoints);
        Assert.Equal(0m, category.NormalizedScore);
    }
}
