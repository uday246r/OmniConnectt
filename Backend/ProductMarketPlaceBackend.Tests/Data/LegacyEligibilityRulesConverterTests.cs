using System.Text.Json;
using ProductMarketplace.Api.Data.Json;
using ProductMarketplace.Api.Models.Entities;
using ProductMarketplace.Api.Models.Json;
using ProductMarketplace.Api.Services.Evaluation;
using ProductMarketplace.Api.Tests.Fakes;

namespace ProductMarketplace.Api.Tests.Data;

/// <summary>
/// Pins the upgrade from the original <c>{ condition, rules }</c> eligibility shape.
/// </summary>
/// <remarks>
/// Worth testing because the failure mode is silent and expensive. System.Text.Json ignores properties
/// it does not recognise, so without the converter every stored product would deserialize to zero
/// criteria — and a product with no criteria is treated as open to everyone. Every gated product would
/// quietly start accepting every applicant, with no exception and nothing in the logs.
///
/// The verdict-parity facts at the end are the ones that matter most: a product stored under the old
/// shape must reach exactly the same eligible/ineligible answer after the change as before it.
/// </remarks>
public class LegacyEligibilityRulesConverterTests
{
    private static EligibilityRulesConfig Read(string json) =>
        JsonSerializer.Deserialize<EligibilityRulesConfig>(json, EligibilityRulesJsonOptions.Value)!;

    private static Product ProductWith(EligibilityRulesConfig eligibility) => new()
    {
        Name = "Test Product",
        Code = "TEST_01",
        EligibilityRules = eligibility,
        ScoringRules = new ScoringRulesConfig()
    };

    private const string LegacyAnd = """
    {
      "condition": "AND",
      "rules": [
        { "ruleId": "ELG_001", "field": "monthly_income", "operator": "GREATER_THAN_OR_EQUAL", "value": 5000, "errorMessage": "Minimum RM 5,000." },
        { "ruleId": "ELG_002", "field": "employment_type", "operator": "IN", "value": ["SALARIED", "SELF_EMPLOYED"] }
      ]
    }
    """;

    private const string LegacyOr = """
    {
      "condition": "OR",
      "rules": [
        { "ruleId": "ELG_001", "field": "monthly_income", "operator": "GREATER_THAN_OR_EQUAL", "value": 50000 },
        { "ruleId": "ELG_002", "field": "employment_type", "operator": "EQUALS", "value": "SALARIED" }
      ]
    }
    """;

    [Fact]
    public void An_AND_condition_becomes_a_list_of_mandatory_criteria()
    {
        var config = Read(LegacyAnd);

        Assert.Equal(2, config.EligibilityCriteria.Count);
        Assert.All(config.EligibilityCriteria, c => Assert.Equal(EligibilityRequirements.Mandatory, c.Requirement));
        Assert.All(config.EligibilityCriteria, c => Assert.Null(c.GroupId));
        Assert.All(config.EligibilityCriteria, c => Assert.True(c.Enabled));
    }

    [Fact]
    public void An_OR_condition_becomes_one_any_of_group()
    {
        var config = Read(LegacyOr);

        Assert.Equal(2, config.EligibilityCriteria.Count);
        Assert.All(config.EligibilityCriteria, c => Assert.Equal(EligibilityRequirements.AnyOf, c.Requirement));
        Assert.Single(config.EligibilityCriteria.Select(c => c.GroupId).Distinct());
        Assert.NotNull(config.EligibilityCriteria[0].GroupId);
    }

    [Fact]
    public void An_unrecognised_condition_upgrades_as_mandatory()
    {
        // Matches the old engine, which treated anything that was not "OR" as AND.
        var config = Read("""{ "condition": "ANY", "rules": [ { "ruleId": "A", "field": "x", "operator": "EQUALS", "value": 1 } ] }""");

        Assert.Equal(EligibilityRequirements.Mandatory, Assert.Single(config.EligibilityCriteria).Requirement);
    }

    [Fact]
    public void The_message_and_the_identifier_survive_the_upgrade()
    {
        var first = Read(LegacyAnd).EligibilityCriteria[0];

        Assert.Equal("ELG_001", first.CriterionId);
        Assert.Equal("Minimum RM 5,000.", first.FailureMessage);
        Assert.Equal("monthly_income", first.Field);
    }

    [Fact]
    public void A_list_value_survives_as_a_comparable_value_not_a_disposed_json_element()
    {
        // The JsonDocument is disposed when the read ends, so a retained JsonElement would throw the
        // moment the engine compared it.
        var second = Read(LegacyAnd).EligibilityCriteria[1];

        var values = Assert.IsType<List<object?>>(second.Value);
        Assert.Equal(["SALARIED", "SELF_EMPLOYED"], values.Cast<string>());
    }

    [Fact]
    public void A_rule_with_no_identifier_is_given_one()
    {
        // Reasons are keyed on the identifier, so a blank one would collide with every other blank.
        var config = Read("""{ "condition": "AND", "rules": [ { "field": "x", "operator": "EQUALS", "value": 1 } ] }""");

        Assert.NotEmpty(Assert.Single(config.EligibilityCriteria).CriterionId);
    }

    [Fact]
    public void The_current_shape_is_read_unchanged()
    {
        var config = Read("""
        {
          "eligibilityCriteria": [
            { "criterionId": "ELG_A", "field": "age", "operator": "GREATER_THAN_OR_EQUAL", "value": 21,
              "requirement": "ANY_OF", "groupId": "GRP_1", "enabled": false }
          ]
        }
        """);

        var criterion = Assert.Single(config.EligibilityCriteria);
        Assert.Equal(EligibilityRequirements.AnyOf, criterion.Requirement);
        Assert.Equal("GRP_1", criterion.GroupId);
        Assert.False(criterion.Enabled);
    }

    [Fact]
    public void The_current_shape_wins_when_a_row_somehow_carries_both()
    {
        var config = Read("""
        {
          "condition": "OR",
          "rules": [ { "ruleId": "OLD", "field": "x", "operator": "EQUALS", "value": 1 } ],
          "eligibilityCriteria": [ { "criterionId": "NEW", "field": "y", "operator": "EQUALS", "value": 2 } ]
        }
        """);

        Assert.Equal("NEW", Assert.Single(config.EligibilityCriteria).CriterionId);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("""{ "rules": [] }""")]
    [InlineData("null")]
    public void An_empty_or_absent_model_reads_as_no_criteria_rather_than_throwing(string json)
    {
        var config = JsonSerializer.Deserialize<EligibilityRulesConfig>(json, EligibilityRulesJsonOptions.Value);

        Assert.Empty(config?.EligibilityCriteria ?? []);
    }

    [Fact]
    public void An_upgraded_model_serializes_back_in_the_current_shape_only()
    {
        var json = JsonSerializer.Serialize(Read(LegacyAnd), EligibilityRulesJsonOptions.Value);

        Assert.Contains("eligibilityCriteria", json);
        Assert.DoesNotContain("\"condition\"", json);
        Assert.DoesNotContain("\"rules\"", json);
    }

    [Fact]
    public void An_upgraded_AND_product_reaches_the_same_verdict_as_before()
    {
        var product = ProductWith(Read(LegacyAnd));
        var engine = new RuleEvaluationEngine(new FakeLogger<RuleEvaluationEngine>());

        var qualifies = engine.Evaluate(product, new Dictionary<string, object?>
        {
            ["monthly_income"] = 8000,
            ["employment_type"] = "SALARIED"
        });
        Assert.True(qualifies.IsEligible);

        // One gate failing is enough, exactly as the old AND behaved.
        var wrongEmployment = engine.Evaluate(product, new Dictionary<string, object?>
        {
            ["monthly_income"] = 8000,
            ["employment_type"] = "FREELANCE"
        });
        Assert.False(wrongEmployment.IsEligible);
    }

    [Fact]
    public void An_upgraded_OR_product_reaches_the_same_verdict_as_before()
    {
        var product = ProductWith(Read(LegacyOr));
        var engine = new RuleEvaluationEngine(new FakeLogger<RuleEvaluationEngine>());

        // One passing member was enough under OR, and is enough as an any-of group.
        var oneMatches = engine.Evaluate(product, new Dictionary<string, object?>
        {
            ["monthly_income"] = 8000,
            ["employment_type"] = "SALARIED"
        });
        Assert.True(oneMatches.IsEligible);

        var neitherMatches = engine.Evaluate(product, new Dictionary<string, object?>
        {
            ["monthly_income"] = 8000,
            ["employment_type"] = "FREELANCE"
        });
        Assert.False(neitherMatches.IsEligible);
    }
}
