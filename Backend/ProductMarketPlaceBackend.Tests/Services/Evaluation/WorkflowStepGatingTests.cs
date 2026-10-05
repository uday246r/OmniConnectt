using ProductMarketplace.Api.Models.Dtos.Runtime;
using ProductMarketplace.Api.Models.Entities;
using ProductMarketplace.Api.Models.Json;
using ProductMarketplace.Api.Services.Evaluation;
using ProductMarketplace.Api.Tests.Fakes;

namespace ProductMarketplace.Api.Tests.Services.Evaluation;

/// <summary>
/// Covers which evaluation phases a workflow's step list turns on, and how steps are handed off.
/// </summary>
/// <remarks>
/// Gating is only safe because a skipped phase says so. A skipped eligibility check reports
/// <c>IsEligible = true</c>, so a consumer that reads that flag without checking
/// <c>EligibilityEvaluated</c> would conclude an applicant passed gates that never ran — the single
/// most damaging way to misread this payload, and the reason these facts exist.
/// <para>
/// The fallback is equally load-bearing: a workflow with no recognised steps runs everything, because
/// otherwise one author saving an empty step list would silently disable every rule on every product
/// sharing that workflow, with no error and nothing visible to show it had happened.
/// </para>
/// </remarks>
public class WorkflowStepGatingTests
{
    private static RuleEvaluationEngine NewEngine() => new(new FakeLogger<RuleEvaluationEngine>());

    private static Workflow WorkflowWith(params string[] stepTypes) => new()
    {
        Name = "Test Workflow",
        Code = "WF_TEST",
        Steps = new WorkflowStepsConfig
        {
            Steps = [.. stepTypes.Select((type, index) => new WorkflowStepDefinition
            {
                Order = index + 1,
                Name = type,
                Type = type
            })]
        }
    };

    /// <summary>A product that would fail its gate and score zero if both phases actually ran.</summary>
    private static Product ProductWith(Workflow? workflow) => new()
    {
        Name = "Gated Product",
        Code = "GATE_01",
        Workflow = workflow!,
        Template = new ProductTemplate
        {
            Name = "T",
            Code = "T",
            FormSchema = new FormSchema
            {
                Sections =
                [
                    new FormSection
                    {
                        Id = "s1", Title = "S", Order = 1,
                        Fields = [new FormField { Key = "monthly_income", Label = "Income", Type = "currency", Required = true, Order = 1 }]
                    }
                ]
            }
        },
        EligibilityRules = new EligibilityRulesConfig
        {
            EligibilityCriteria =
            [
                new EligibilityCriterion
                {
                    CriterionId = "ELG_001",
                    Field = "monthly_income",
                    Operator = "GREATER_THAN_OR_EQUAL",
                    Value = 100000,
                    FailureMessage = "Income too low."
                }
            ]
        },
        ScoringRules = new ScoringRulesConfig
        {
            ScoringCategories =
            [
                new ScoringCategory
                {
                    Key = "FINANCIAL_HEALTH", Label = "Financial Health",
                    ScoredFields =
                    [
                        new ScoredField
                        {
                            Key = "MONTHLY_INCOME", Label = "Monthly Income", FormField = "monthly_income",
                            ScoringStyle = ScoringStyles.BestMatch,
                            ScoreRanges = [new ScoreRange { RangeId = "SCR_001", Operator = "GREATER_THAN_OR_EQUAL", Value = 1000, Points = 25 }]
                        }
                    ]
                }
            ]
        }
    };

    private static Dictionary<string, object?> Submission() => new() { ["monthly_income"] = 5000 };

    [Fact]
    public void A_workflow_that_omits_the_eligibility_step_skips_the_gates_and_declares_it_skipped()
    {
        var product = ProductWith(WorkflowWith(WorkflowStepTypes.ValidateForm, WorkflowStepTypes.CalculateScore));

        var result = NewEngine().Evaluate(product, Submission());

        Assert.False(result.EligibilityEvaluated);
        Assert.True(result.IsEligible);
        Assert.Empty(result.IneligibilityReasons);

        Assert.True(result.ScoringEvaluated);
        Assert.Equal(25, result.TotalEarnedPoints);
    }

    [Fact]
    public void A_workflow_that_includes_the_eligibility_step_applies_the_gates()
    {
        var product = ProductWith(WorkflowWith(
            WorkflowStepTypes.ValidateForm, WorkflowStepTypes.EvaluateEligibility, WorkflowStepTypes.CalculateScore));

        var result = NewEngine().Evaluate(product, Submission());

        Assert.True(result.EligibilityEvaluated);
        Assert.False(result.IsEligible);
        Assert.Equal("Income too low.", Assert.Single(result.IneligibilityReasons).Message);
    }

    [Fact]
    public void A_workflow_that_omits_the_scoring_step_returns_no_factors_and_declares_it_skipped()
    {
        var product = ProductWith(WorkflowWith(WorkflowStepTypes.ValidateForm, WorkflowStepTypes.EvaluateEligibility));

        var result = NewEngine().Evaluate(product, Submission());

        Assert.False(result.ScoringEvaluated);
        Assert.Empty(result.ScoringCategories);
        Assert.Equal(0, result.TotalMaxPoints);
    }

    [Fact]
    public void A_workflow_with_no_recognised_steps_runs_every_phase_rather_than_none()
    {
        var product = ProductWith(WorkflowWith("ASSIGN_AGENT", "SEND_NOTIFICATION"));

        var result = NewEngine().Evaluate(product, Submission());

        Assert.True(result.FormValidationEvaluated);
        Assert.True(result.EligibilityEvaluated);
        Assert.True(result.ScoringEvaluated);
        Assert.False(result.IsEligible);
    }

    [Fact]
    public void A_product_with_no_workflow_at_all_runs_every_phase()
    {
        var result = NewEngine().Evaluate(ProductWith(null), Submission());

        Assert.True(result.EligibilityEvaluated);
        Assert.True(result.ScoringEvaluated);
        Assert.Empty(result.ExecutedSteps);
        Assert.Empty(result.HandoffSteps);
    }

    [Fact]
    public void Steps_are_split_into_what_this_service_ran_and_what_the_consumer_must_run()
    {
        var product = ProductWith(WorkflowWith(
            WorkflowStepTypes.ValidateForm,
            WorkflowStepTypes.EvaluateEligibility,
            WorkflowStepTypes.CalculateScore,
            WorkflowStepTypes.AssignAgent,
            WorkflowStepTypes.SendNotification));

        var result = NewEngine().Evaluate(product, Submission());

        Assert.Equal(
            [WorkflowStepTypes.ValidateForm, WorkflowStepTypes.EvaluateEligibility, WorkflowStepTypes.CalculateScore],
            result.ExecutedSteps.Select(s => s.Type));

        Assert.Equal(
            [WorkflowStepTypes.AssignAgent, WorkflowStepTypes.SendNotification],
            result.HandoffSteps.Select(s => s.Type));
    }

    [Fact]
    public void An_author_invented_step_type_is_handed_off_rather_than_dropped_or_rejected()
    {
        // This database already contains a CREDIT_BUREAU_PULL step. A type this service cannot interpret
        // is exactly a step for somebody else, so it must survive into the handoff list.
        var product = ProductWith(WorkflowWith(
            WorkflowStepTypes.ValidateForm, "CREDIT_BUREAU_PULL", WorkflowStepTypes.CalculateScore));

        var result = NewEngine().Evaluate(product, Submission());

        Assert.Equal("CREDIT_BUREAU_PULL", Assert.Single(result.HandoffSteps).Type);
        Assert.DoesNotContain("CREDIT_BUREAU_PULL", result.ExecutedSteps.Select(s => s.Type));
    }

    [Fact]
    public void Handoff_steps_keep_their_config_so_the_consumer_can_act_on_them()
    {
        var workflow = WorkflowWith(WorkflowStepTypes.CalculateScore, WorkflowStepTypes.AssignAgent);
        workflow.Steps.Steps[1].Config = new Dictionary<string, object?>
        {
            ["assignmentStrategy"] = "ROUND_ROBIN",
            ["slaMinutes"] = 120
        };

        var result = NewEngine().Evaluate(ProductWith(workflow), Submission());

        var handoff = Assert.Single(result.HandoffSteps);
        Assert.Equal("ROUND_ROBIN", handoff.Config?["assignmentStrategy"]);
        Assert.Equal(120, handoff.Config?["slaMinutes"]);
    }

    [Fact]
    public void Execution_follows_the_workflow_s_own_order_rather_than_a_fixed_sequence()
    {
        // Scoring declared first, eligibility second — the opposite of the fixed order this engine used
        // to run them in. Every phase is still evaluated, and each phase's own result is identical to
        // running them in the "usual" order, because none of the three reads what another produced.
        var reordered = WorkflowWith(
            WorkflowStepTypes.CalculateScore, WorkflowStepTypes.EvaluateEligibility, WorkflowStepTypes.ValidateForm);

        var result = NewEngine().Evaluate(ProductWith(reordered), Submission());

        Assert.True(result.FormValidationEvaluated);
        Assert.True(result.EligibilityEvaluated);
        Assert.False(result.IsEligible);
        Assert.True(result.ScoringEvaluated);
        Assert.Equal(25, result.TotalEarnedPoints);
    }

    [Fact]
    public void Steps_are_reported_in_order_even_when_stored_out_of_order()
    {
        var workflow = WorkflowWith(WorkflowStepTypes.CalculateScore, WorkflowStepTypes.ValidateForm);
        workflow.Steps.Steps[0].Order = 2;
        workflow.Steps.Steps[1].Order = 1;

        var result = NewEngine().Evaluate(ProductWith(workflow), Submission());

        Assert.Equal(
            [WorkflowStepTypes.ValidateForm, WorkflowStepTypes.CalculateScore],
            result.ExecutedSteps.Select(s => s.Type));
    }

    [Fact]
    public void An_unanswered_gate_is_reported_as_missing_rather_than_as_a_rejection()
    {
        // Gates run on possibly-incomplete data. Without the cause, an operator reads "Income too low."
        // for an applicant who simply has not answered yet.
        var product = ProductWith(WorkflowWith(WorkflowStepTypes.EvaluateEligibility));

        var result = NewEngine().Evaluate(product, new Dictionary<string, object?> { ["monthly_income"] = "" });

        var reason = Assert.Single(result.IneligibilityReasons);
        Assert.Equal(IneligibilityCauses.MissingValue, reason.Cause);
        Assert.Equal("monthly_income", reason.Field);
    }

    [Fact]
    public void An_answered_but_failing_gate_is_reported_as_a_genuine_failure()
    {
        var product = ProductWith(WorkflowWith(WorkflowStepTypes.EvaluateEligibility));

        var result = NewEngine().Evaluate(product, Submission());

        Assert.Equal(IneligibilityCauses.Failed, Assert.Single(result.IneligibilityReasons).Cause);
    }

    [Fact]
    public void A_lead_is_decision_ready_only_when_the_form_is_valid_and_the_gates_passed()
    {
        var failing = ProductWith(WorkflowWith(
            WorkflowStepTypes.ValidateForm, WorkflowStepTypes.EvaluateEligibility, WorkflowStepTypes.CalculateScore));

        var failingResult = NewEngine().Evaluate(failing, Submission());
        Assert.True(failingResult.IsFormValid);
        Assert.False(failingResult.IsEligible);
        Assert.False(failingResult.IsDecisionReady);

        // Scoring still ran, so an operator can see an indicative score on a lead that is not yet actionable.
        Assert.True(failingResult.ScoringEvaluated);
        Assert.Equal(25, failingResult.TotalEarnedPoints);
    }

    [Fact]
    public void An_invalid_form_is_still_scored_so_a_partial_lead_is_not_mistaken_for_a_bad_one()
    {
        var product = ProductWith(WorkflowWith(WorkflowStepTypes.ValidateForm, WorkflowStepTypes.CalculateScore));

        // monthly_income is required by the schema and absent, so the form is invalid.
        var result = NewEngine().Evaluate(product, new Dictionary<string, object?>());

        Assert.True(result.FormValidationEvaluated);
        Assert.False(result.IsFormValid);
        Assert.False(result.IsDecisionReady);
        Assert.True(result.ScoringEvaluated);
    }
}
