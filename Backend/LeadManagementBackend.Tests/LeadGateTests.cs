using LeadManagement.Api.Data;
using LeadManagement.Api.Exceptions;
using LeadManagement.Api.Models.Dtos.Leads;
using LeadManagement.Api.Models.Enums;
using LeadManagement.Api.Models.Marketplace;
using LeadManagement.Api.Services;
using LeadManagement.Api.Services.Marketplace;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LeadManagement.Tests;

/// <summary>
/// The workflow is validation, then eligibility, then — only for an applicant who passed both — scoring.
/// The property worth pinning is that it is a GATE: a refused submission must never reach the scorer and
/// must never leave a lead row behind, because a Hot/Warm/Cold verdict on someone the product cannot
/// serve is worse than no verdict. The marketplace, scorer and configuration are faked; the real
/// <see cref="LeadService"/> and identity mapper run.
/// </summary>
public class LeadGateTests : IDisposable
{
    private readonly LeadManagementDbContext db;
    private readonly FakeMarketplace marketplace = new();
    private readonly FakeScorer scorer = new();
    private readonly LeadService service;

    public LeadGateTests()
    {
        db = new LeadManagementDbContext(new DbContextOptionsBuilder<LeadManagementDbContext>()
            .UseInMemoryDatabase($"lead-gate-{Guid.NewGuid()}").Options);

        service = new LeadService(
            db, marketplace, new FakeScoringConfig(), scorer, new IdentityFieldMapper(),
            NullLogger<LeadService>.Instance);
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    private static CreateLeadRequest Request() => new()
    {
        FirstName = "Aisha", LastName = "Rahman", Email = "aisha@example.com", Phone = "+60 12 345 6789",
        ProductId = Guid.NewGuid(),
    };

    // ---------------------------------------------------------------- the check (no score, no save)

    [Fact]
    public async Task Checking_reports_form_errors_without_scoring_or_saving_anything()
    {
        marketplace.Evaluation = Evaluation(formValid: false, errors: ["Field 'Monthly income' (income) is required."]);

        var check = await service.CheckApplicationAsync(Guid.NewGuid(), new CheckApplicationRequest());

        Assert.False(check.IsFormValid);
        Assert.Equal(["Field 'Monthly income' (income) is required."], check.ValidationErrors);
        Assert.False(check.CanProceed);
        Assert.Equal(0, scorer.Calls);
        Assert.Empty(db.Leads);
    }

    [Fact]
    public async Task Checking_reports_the_eligibility_reasons_and_blocks_an_ineligible_applicant()
    {
        marketplace.Evaluation = Evaluation(eligible: false, reasons: [new MarketplaceIneligibilityReason { ReasonId = "r1", Message = "Minimum age is 21." }]);

        var check = await service.CheckApplicationAsync(Guid.NewGuid(), new CheckApplicationRequest());

        Assert.True(check.IsFormValid);
        Assert.False(check.IsEligible);
        Assert.Equal("Minimum age is 21.", Assert.Single(check.IneligibilityReasons).Message);
        Assert.False(check.CanProceed);
        Assert.Equal(0, scorer.Calls);
    }

    [Fact]
    public async Task Checking_a_valid_eligible_application_says_it_can_proceed_and_still_does_not_score()
    {
        var check = await service.CheckApplicationAsync(Guid.NewGuid(), new CheckApplicationRequest());

        Assert.True(check.CanProceed);
        Assert.Equal(0, scorer.Calls);
        Assert.Empty(db.Leads);
    }

    [Fact]
    public async Task Checking_accepts_a_half_filled_identity_because_the_form_is_checked_while_it_is_being_typed()
    {
        var check = await service.CheckApplicationAsync(Guid.NewGuid(), new CheckApplicationRequest { Email = "aisha@" });

        Assert.NotNull(check);
    }

    [Theory]
    [InlineData(true, true, true, true, true)]
    [InlineData(true, false, true, true, false)]   // form errors
    [InlineData(true, true, true, false, false)]   // ineligible
    [InlineData(false, false, true, true, true)]   // validation phase not run: "not checked", not "failed"
    [InlineData(true, true, false, false, true)]   // eligibility phase not run: does not block
    public void CanProceed_treats_a_phase_the_workflow_did_not_run_as_not_checked_rather_than_failed(
        bool validationRan, bool valid, bool eligibilityRan, bool eligible, bool expected)
    {
        var e = new MarketplaceEvaluationResult
        {
            FormValidationEvaluated = validationRan, IsFormValid = valid,
            EligibilityEvaluated = eligibilityRan, IsEligible = eligible,
        };

        Assert.Equal(expected, LeadService.CanProceed(e));
    }

    // ---------------------------------------------------------------- creating (the gate)

    [Fact]
    public async Task A_submission_with_form_errors_is_refused_before_scoring_and_nothing_is_stored()
    {
        marketplace.Evaluation = Evaluation(formValid: false, errors: ["Field 'Age' must be at least 21."]);

        var ex = await Assert.ThrowsAsync<ValidationException>(() => service.CreateLeadAsync(Request()));

        Assert.Equal(["Field 'Age' must be at least 21."], ex.Errors);
        Assert.Equal(0, scorer.Calls);
        Assert.Empty(db.Leads);
    }

    [Fact]
    public async Task An_ineligible_applicant_is_refused_with_the_reasons_and_is_never_scored_or_stored()
    {
        marketplace.Evaluation = Evaluation(eligible: false, reasons:
        [
            new MarketplaceIneligibilityReason { ReasonId = "r1", Message = "Minimum age is 21." },
            new MarketplaceIneligibilityReason { ReasonId = "r2", Message = "Monthly income is below RM 3,000." },
        ]);

        var ex = await Assert.ThrowsAsync<ApplicantIneligibleException>(() => service.CreateLeadAsync(Request()));

        Assert.Equal(["Minimum age is 21.", "Monthly income is below RM 3,000."], ex.Reasons);
        Assert.Equal(0, scorer.Calls);
        Assert.Empty(db.Leads);
    }

    [Fact]
    public async Task Form_errors_win_over_ineligibility_so_the_applicant_fixes_the_form_first()
    {
        marketplace.Evaluation = Evaluation(formValid: false, eligible: false, errors: ["Field 'Age' is required."]);

        await Assert.ThrowsAsync<ValidationException>(() => service.CreateLeadAsync(Request()));
    }

    [Fact]
    public async Task An_eligible_valid_applicant_passes_the_gate_and_reaches_the_scorer()
    {
        // LeadService takes its reference from a PostgreSQL sequence, which the in-memory provider cannot
        // run, so persistence itself fails here. What this pins is that the gate LET THE APPLICANT
        // THROUGH: scoring is reached, which is the only thing a refusal must prevent.
        await Record.ExceptionAsync(() => service.CreateLeadAsync(Request()));

        Assert.Equal(1, scorer.Calls);
    }

    [Fact]
    public async Task A_workflow_with_no_eligibility_phase_does_not_refuse_anyone()
    {
        var e = Evaluation();
        e.EligibilityEvaluated = false;
        e.IsEligible = false; // "not run" leaves this false — it must not be read as a refusal
        marketplace.Evaluation = e;

        await Record.ExceptionAsync(() => service.CreateLeadAsync(Request()));

        Assert.Equal(1, scorer.Calls);
    }

    // ---------------------------------------------------------------- fakes

    private static MarketplaceEvaluationResult Evaluation(
        bool formValid = true, bool eligible = true, List<string>? errors = null, List<MarketplaceIneligibilityReason>? reasons = null) => new()
    {
        FormValidationEvaluated = true,
        IsFormValid = formValid,
        ValidationErrors = errors ?? [],
        EligibilityEvaluated = true,
        IsEligible = eligible,
        IneligibilityReasons = reasons ?? [],
        ScoringEvaluated = true,
        EvaluatedAt = DateTimeOffset.UtcNow,
    };

    private sealed class FakeMarketplace : IMarketplaceClient
    {
        public MarketplaceEvaluationResult Evaluation { get; set; } = LeadGateTests.Evaluation();

        public Task<MarketplaceProductConfiguration> GetProductConfigurationAsync(Guid productId, CancellationToken ct = default) =>
            Task.FromResult(new MarketplaceProductConfiguration
            {
                ProductId = productId, ProductName = "Personal Financing", ProductCode = "PF-01",
                Category = new MarketplaceCategory { Id = Guid.NewGuid(), Name = "Financing" },
            });

        public Task<MarketplaceEvaluationResult> EvaluateAsync(Guid productId, Dictionary<string, object?> formData, string? currency, CancellationToken ct = default) =>
            Task.FromResult(Evaluation);

        public Task<List<MarketplaceCategory>> GetCategoriesAsync(CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<MarketplaceProductCard>> GetProductsAsync(Guid? categoryId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MarketplaceScoringCategoryCatalog> GetScoringCategoriesAsync(CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MarketplaceValueList> GetValueListByKeyAsync(string key, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MarketplaceValueList> UpdateValueListAsync(Guid id, MarketplaceUpdateValueListRequest request, CancellationToken ct = default) => throw new NotSupportedException();
    }

    private sealed class FakeScorer : ILeadScoringService
    {
        public int Calls { get; private set; }

        public LeadScoreResult Score(IReadOnlyList<MarketplaceFactorScore> producedFactors, ScoringModel model)
        {
            Calls++;
            return new LeadScoreResult { FinalScore = 70, Classification = LeadClassification.WARM, HotThreshold = 80, WarmThreshold = 55 };
        }
    }

    private sealed class FakeScoringConfig : IScoringConfigurationService
    {
        public Task<(ScoringModel Model, Guid ConfigurationId)> GetActiveModelAsync(CancellationToken ct = default)
        {
            var id = Guid.NewGuid();
            return Task.FromResult((new ScoringModel(id, 1, "Default", 80, 55, []), id));
        }

        public Task<LeadManagement.Api.Models.Dtos.Scoring.ScoringConfigurationResponse> GetActiveAsync(CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<LeadManagement.Api.Models.Dtos.Scoring.ScoringConfigurationResponse>> GetVersionsAsync(CancellationToken ct = default) => throw new NotSupportedException();
        public Task<LeadManagement.Api.Models.Dtos.Scoring.ScoringFactorsResponse> GetFactorsAsync(CancellationToken ct = default) => throw new NotSupportedException();
        public Task<LeadManagement.Api.Models.Dtos.Scoring.ScoringConfigurationResponse> PublishAsync(LeadManagement.Api.Models.Dtos.Scoring.UpdateScoringConfigurationRequest request, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<LeadManagement.Api.Models.Dtos.Scoring.PublishCategoriesResult> PublishCategoriesToMarketplaceAsync(CancellationToken ct = default) => throw new NotSupportedException();
    }
}
