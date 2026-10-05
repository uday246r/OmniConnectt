using ProductMarketplace.Api.Models.Dtos.Runtime;
using ProductMarketplace.Api.Models.Entities;
using ProductMarketplace.Api.Models.Json;
using ProductMarketplace.Api.Services.Evaluation;
using ProductMarketplace.Api.Tests.Fakes;

namespace ProductMarketplace.Api.Tests.Services.Evaluation;

/// <summary>
/// Pins the eligibility and operator-coercion behaviour that must survive the scoring reshape.
/// </summary>
/// <remarks>
/// The scoring model is being restructured from a flat rule list into factors and criteria, which
/// touches the same engine. Eligibility, the operator set and field-key resolution are NOT part of
/// that change, so these facts are the regression net proving the reshape did not disturb them.
/// They are written against current behaviour on purpose, including the deliberately lenient value
/// coercion — a test that starts passing for a new reason is worth less than one that fails.
/// </remarks>
public class RuleEvaluationEngineBaselineTests
{
    private static RuleEvaluationEngine NewEngine() => new(new FakeLogger<RuleEvaluationEngine>());

    private static Product ProductWith(EligibilityRulesConfig eligibility) => new()
    {
        Name = "Test Product",
        Code = "TEST_01",
        EligibilityRules = eligibility,
        ScoringRules = new ScoringRulesConfig()
    };

    private static EligibilityCriterion Rule(
        string field,
        string op,
        object? value,
        string? message = null,
        string requirement = EligibilityRequirements.Mandatory,
        string? groupId = null) => new()
    {
        CriterionId = $"ELG_{field}",
        Field = field,
        Operator = op,
        Value = value,
        FailureMessage = message,
        Requirement = requirement,
        GroupId = groupId
    };

    [Fact]
    public void Every_mandatory_criterion_must_pass()
    {
        var product = ProductWith(new EligibilityRulesConfig
        {
            EligibilityCriteria =
            [
                Rule("monthly_income", "GREATER_THAN_OR_EQUAL", 5000),
                Rule("employment_type", "IN", new[] { "SALARIED", "SELF_EMPLOYED" })
            ]
        });

        var result = NewEngine().Evaluate(product, new Dictionary<string, object?>
        {
            ["monthly_income"] = 8000,
            ["employment_type"] = "FREELANCE"
        });

        Assert.False(result.IsEligible);
        Assert.Single(result.IneligibilityReasons);
    }

    [Fact]
    public void One_passing_member_carries_an_any_of_group()
    {
        var product = ProductWith(new EligibilityRulesConfig
        {
            EligibilityCriteria =
            [
                Rule("monthly_income", "GREATER_THAN_OR_EQUAL", 50000, requirement: EligibilityRequirements.AnyOf, groupId: "GRP_A"),
                Rule("employment_type", "EQUALS", "SALARIED", requirement: EligibilityRequirements.AnyOf, groupId: "GRP_A")
            ]
        });

        var result = NewEngine().Evaluate(product, new Dictionary<string, object?>
        {
            ["monthly_income"] = 8000,
            ["employment_type"] = "SALARIED"
        });

        Assert.True(result.IsEligible);
        Assert.Empty(result.IneligibilityReasons);
    }

    [Fact]
    public void An_any_of_group_refuses_once_every_member_fails()
    {
        var product = ProductWith(new EligibilityRulesConfig
        {
            EligibilityCriteria =
            [
                Rule("monthly_income", "GREATER_THAN_OR_EQUAL", 50000, requirement: EligibilityRequirements.AnyOf, groupId: "GRP_A"),
                Rule("employment_type", "EQUALS", "SALARIED", requirement: EligibilityRequirements.AnyOf, groupId: "GRP_A")
            ]
        });

        var result = NewEngine().Evaluate(product, new Dictionary<string, object?>
        {
            ["monthly_income"] = 8000,
            ["employment_type"] = "FREELANCE"
        });

        Assert.False(result.IsEligible);

        // One reason for the group, not one per member — the applicant failed a single requirement.
        var reason = Assert.Single(result.IneligibilityReasons);
        Assert.Equal(EligibilityRequirements.AnyOf, reason.Requirement);
        Assert.Equal("GRP_A", reason.GroupId);
        Assert.Equal(2, reason.MemberRuleIds.Count);
        Assert.Empty(reason.RuleId);
        Assert.NotEmpty(reason.ReasonId);
    }

    [Fact]
    public void Mandatory_and_any_of_criteria_are_enforced_together()
    {
        // The policy the old global AND/OR could not express: one gate that must always hold, plus a
        // choice between two acceptable alternatives.
        var product = ProductWith(new EligibilityRulesConfig
        {
            EligibilityCriteria =
            [
                Rule("age", "GREATER_THAN_OR_EQUAL", 21),
                Rule("payslip", "EQUALS", "YES", requirement: EligibilityRequirements.AnyOf, groupId: "PROOF"),
                Rule("bank_statement", "EQUALS", "YES", requirement: EligibilityRequirements.AnyOf, groupId: "PROOF")
            ]
        });

        var passes = NewEngine().Evaluate(product, new Dictionary<string, object?>
        {
            ["age"] = 30,
            ["payslip"] = "NO",
            ["bank_statement"] = "YES"
        });
        Assert.True(passes.IsEligible);

        // The mandatory gate is not excused by the group passing.
        var tooYoung = NewEngine().Evaluate(product, new Dictionary<string, object?>
        {
            ["age"] = 18,
            ["payslip"] = "YES",
            ["bank_statement"] = "YES"
        });
        Assert.False(tooYoung.IsEligible);
    }

    [Fact]
    public void A_disabled_criterion_is_not_applied()
    {
        var product = ProductWith(new EligibilityRulesConfig
        {
            EligibilityCriteria =
            [
                new EligibilityCriterion
                {
                    CriterionId = "ELG_OFF",
                    Field = "monthly_income",
                    Operator = "GREATER_THAN_OR_EQUAL",
                    Value = 50000,
                    Enabled = false
                }
            ]
        });

        var result = NewEngine().Evaluate(product, new Dictionary<string, object?> { ["monthly_income"] = 1000 });

        Assert.True(result.IsEligible);
        Assert.Empty(result.IneligibilityReasons);
    }

    [Fact]
    public void A_criterion_stored_before_the_enabled_flag_existed_still_applies()
    {
        // Guards the `= true` initializer on Enabled. With a bare bool, every gate written before the
        // flag existed would read as disabled and every product would accept everyone.
        var criterion = new EligibilityCriterion
        {
            CriterionId = "ELG_001",
            Field = "monthly_income",
            Operator = "GREATER_THAN_OR_EQUAL",
            Value = 5000
        };

        Assert.True(criterion.Enabled);
    }

    [Theory]
    [InlineData(null, EligibilityRequirements.Mandatory)]
    [InlineData("", EligibilityRequirements.Mandatory)]
    [InlineData("NONSENSE", EligibilityRequirements.Mandatory)]
    [InlineData("any_of", EligibilityRequirements.AnyOf)]
    [InlineData("ANY_OF", EligibilityRequirements.AnyOf)]
    public void An_unrecognised_requirement_is_read_as_mandatory(string? stored, string expected)
    {
        // Defaults to the strict option: reading an unknown value as ANY_OF would let one passing gate
        // carry an applicant past every other one.
        Assert.Equal(expected, EligibilityRequirements.Normalize(stored));
    }

    [Fact]
    public void A_product_with_no_eligibility_rules_is_eligible_by_design()
    {
        var product = ProductWith(new EligibilityRulesConfig { EligibilityCriteria = [] });

        var result = NewEngine().Evaluate(product, new Dictionary<string, object?>());

        Assert.True(result.IsEligible);
    }

    [Theory]
    [InlineData("5000", true)]
    [InlineData("RM 5,000", true)]
    [InlineData("5,000.00", true)]
    [InlineData(5000, true)]
    [InlineData(5000.0, true)]
    [InlineData("4999", false)]
    [InlineData("not a number", false)]
    [InlineData(null, false)]
    public void A_numeric_comparison_coerces_loosely_formatted_values_and_fails_closed_otherwise(
        object? submitted, bool expectedEligible)
    {
        var product = ProductWith(new EligibilityRulesConfig
        {
            EligibilityCriteria = [Rule("monthly_income", "GREATER_THAN_OR_EQUAL", 5000)]
        });

        var result = NewEngine().Evaluate(product, new Dictionary<string, object?> { ["monthly_income"] = submitted });

        Assert.Equal(expectedEligible, result.IsEligible);
    }

    [Theory]
    [InlineData("monthly_income")]
    [InlineData("monthlyIncome")]
    [InlineData("Monthly Income")]
    [InlineData("MONTHLY_INCOME")]
    public void A_field_key_is_matched_after_stripping_case_and_separators(string submittedKey)
    {
        var product = ProductWith(new EligibilityRulesConfig
        {
            EligibilityCriteria = [Rule("monthly_income", "GREATER_THAN_OR_EQUAL", 5000)]
        });

        var result = NewEngine().Evaluate(product, new Dictionary<string, object?> { [submittedKey] = 8000 });

        Assert.True(result.IsEligible);
    }

    [Theory]
    [InlineData(true, true)]
    [InlineData("true", true)]
    [InlineData("yes", true)]
    [InlineData(false, false)]
    [InlineData("no", false)]
    public void A_boolean_equality_check_accepts_both_real_booleans_and_bool_like_strings(
        object submitted, bool expectedEligible)
    {
        var product = ProductWith(new EligibilityRulesConfig
        {
            EligibilityCriteria = [Rule("consent_given", "EQUALS", true)]
        });

        var result = NewEngine().Evaluate(product, new Dictionary<string, object?> { ["consent_given"] = submitted });

        Assert.Equal(expectedEligible, result.IsEligible);
    }

    [Theory]
    [InlineData(7500, true)]
    [InlineData(5000, true)]
    [InlineData(9999, true)]
    [InlineData(4999, false)]
    [InlineData(10000, false)]
    public void BETWEEN_is_inclusive_of_both_bounds(int submitted, bool expectedEligible)
    {
        var product = ProductWith(new EligibilityRulesConfig
        {
            EligibilityCriteria = [Rule("monthly_income", "BETWEEN", new[] { 5000, 9999 })]
        });

        var result = NewEngine().Evaluate(product, new Dictionary<string, object?> { ["monthly_income"] = submitted });

        Assert.Equal(expectedEligible, result.IsEligible);
    }

    /// <summary>
    /// BETWEEN on a date field — the exact shape of a "date of birth" eligibility gate ("born between
    /// 1960-01-01 and 2007-12-31", i.e. an age range). Regression for a real bug: IsBetween tried only
    /// TryConvertToDecimal, which cannot read a date at all, so this returned false for every applicant
    /// no matter what date was submitted — every date-of-birth BETWEEN gate rejected everyone,
    /// unconditionally.
    /// </summary>
    [Theory]
    [InlineData("1995-06-15", true)]   // well inside the range
    [InlineData("1960-01-01", true)]   // lower bound, inclusive
    [InlineData("2007-12-31", true)]   // upper bound, inclusive
    [InlineData("1959-12-31", false)]  // one day before the lower bound
    [InlineData("2008-01-01", false)]  // one day after the upper bound
    public void BETWEEN_on_a_date_field_reads_the_dates_instead_of_always_failing(string dateOfBirth, bool expectedEligible)
    {
        var product = ProductWith(new EligibilityRulesConfig
        {
            EligibilityCriteria = [Rule("date_of_birth", "BETWEEN", new[] { "1960-01-01", "2007-12-31" })]
        });

        var result = NewEngine().Evaluate(product, new Dictionary<string, object?> { ["date_of_birth"] = dateOfBirth });

        Assert.Equal(expectedEligible, result.IsEligible);
    }

    [Fact]
    public void BETWEEN_on_a_date_field_still_names_the_field_in_the_refusal_reason()
    {
        var product = ProductWith(new EligibilityRulesConfig
        {
            EligibilityCriteria = [Rule("date_of_birth", "BETWEEN", new[] { "1960-01-01", "2007-12-31" })]
        });

        var result = NewEngine().Evaluate(product, new Dictionary<string, object?> { ["date_of_birth"] = "2015-01-01" });

        Assert.False(result.IsEligible);
        Assert.Contains("date_of_birth", Assert.Single(result.IneligibilityReasons).Message);
    }

    [Fact]
    public void BETWEEN_on_a_date_field_reports_a_missing_answer_as_unanswered_not_a_rejection()
    {
        var product = ProductWith(new EligibilityRulesConfig
        {
            EligibilityCriteria = [Rule("date_of_birth", "BETWEEN", new[] { "1960-01-01", "2007-12-31" })]
        });

        var result = NewEngine().Evaluate(product, new Dictionary<string, object?>());

        Assert.Equal(IneligibilityCauses.MissingValue, Assert.Single(result.IneligibilityReasons).Cause);
    }

    [Fact]
    public void BETWEEN_still_reads_a_genuinely_numeric_range_correctly_after_the_date_fix()
    {
        // The date path must never hijack a plain numeric BETWEEN: neither the submitted value nor the
        // bounds here contain a date separator, so TryConvertToDateTime must refuse all of them and the
        // decimal path must still run.
        var product = ProductWith(new EligibilityRulesConfig
        {
            EligibilityCriteria = [Rule("monthly_income", "BETWEEN", new[] { 5000, 9999 })]
        });

        var result = NewEngine().Evaluate(product, new Dictionary<string, object?> { ["monthly_income"] = 7500 });

        Assert.True(result.IsEligible);
    }

    [Fact]
    public void An_unknown_operator_fails_closed_and_is_logged_rather_than_silently_ignored()
    {
        var logger = new FakeLogger<RuleEvaluationEngine>();
        var engine = new RuleEvaluationEngine(logger);
        var product = ProductWith(new EligibilityRulesConfig
        {
            EligibilityCriteria = [Rule("monthly_income", "APPROXIMATELY", 5000)]
        });

        var result = engine.Evaluate(product, new Dictionary<string, object?> { ["monthly_income"] = 5000 });

        Assert.False(result.IsEligible);
        Assert.Contains(logger.Entries, e => e.Contains("APPROXIMATELY", StringComparison.Ordinal));
    }
}
