using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Api.Data;
using ProductMarketplace.Api.Models.Entities;
using ProductMarketplace.Api.Models.Json;
using ProductMarketplace.Api.Services.Currency;
using ProductMarketplace.Api.Services.Evaluation;
using ProductMarketplace.Api.Tests.Fakes;

namespace ProductMarketplace.Api.Tests.Services;

/// <summary>
/// Covers converting an applicant's monetary figures into a product's currency before rules are applied.
/// </summary>
/// <remarks>
/// <para>This closes a real mis-lending defect. <c>TryParseDecimalString</c> strips every non-numeric
/// character from a value, so before conversion existed "RM 5000" and "₹5000" both parsed to 5000m and
/// compared equal — a ₹50,000 salary (about RM 2,600) satisfied an "at least RM 5,000" gate outright.
/// The first test below is that exact scenario.</para>
///
/// <para>The invariant worth stating: only the SUBMITTED side is converted. Thresholds on rules, and a
/// field's min/max, are authored in the product's base currency by definition — converting them too
/// would cancel out and leave the original bug intact.</para>
/// </remarks>
public class CurrencyConversionTests : IDisposable
{
    private readonly ProductMarketplaceDbContext db;

    public CurrencyConversionTests()
    {
        var options = new DbContextOptionsBuilder<ProductMarketplaceDbContext>()
            .UseInMemoryDatabase($"currency-{Guid.NewGuid()}")
            .Options;
        db = new ProductMarketplaceDbContext(options);
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    private CurrencyService NewService() => new(db, new FakeLogger<CurrencyService>());

    private static RuleEvaluationEngine NewEngine() => new(new FakeLogger<RuleEvaluationEngine>());

    private async Task SeedCurrenciesAsync(params (string Code, int Decimals)[] currencies)
    {
        foreach (var (code, decimals) in currencies)
        {
            db.Currencies.Add(new Currency
            {
                Code = code, Name = code, Symbol = code, DecimalPlaces = decimals, IsActive = true
            });
        }
        await db.SaveChangesAsync();
    }

    private async Task SeedRateAsync(string from, string to, decimal rate, int daysAgo = 0)
    {
        db.ExchangeRates.Add(new ExchangeRate
        {
            FromCurrency = from,
            ToCurrency = to,
            Rate = rate,
            EffectiveFrom = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-daysAgo)),
            Source = "TEST"
        });
        await db.SaveChangesAsync();
    }

    /// <summary>A product priced in MYR whose gate is "monthly income of at least 5,000".</summary>
    private static Product MyrProductRequiring(decimal minimumIncome) => new()
    {
        Name = "Platinum Card",
        Code = "PC_PLAT",
        BaseCurrency = "MYR",
        Template = new ProductTemplate
        {
            Name = "T", Code = "T",
            FormSchema = new FormSchema
            {
                Sections =
                [
                    new FormSection
                    {
                        Id = "s1", Title = "Financials", Order = 1,
                        Fields =
                        [
                            new FormField { Key = "monthly_income", Label = "Monthly Income", Type = "currency", Order = 1 },
                            new FormField { Key = "age", Label = "Age", Type = "number", Order = 2 }
                        ]
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
                    CriterionId = "ELG_INCOME",
                    Field = "monthly_income",
                    Operator = "GREATER_THAN_OR_EQUAL",
                    Value = minimumIncome,
                    FailureMessage = "Minimum monthly income not met."
                }
            ]
        },
        ScoringRules = new ScoringRulesConfig()
    };

    // ---------------------------------------------------------------- the headline defect

    [Fact]
    public async Task A_foreign_salary_is_converted_before_a_gate_is_applied()
    {
        // ₹50,000 is about RM 2,665 — well under the RM 5,000 gate. Before conversion existed the
        // currency marker was stripped and the raw 50000 sailed past the threshold.
        await SeedCurrenciesAsync(("MYR", 2), ("INR", 2));
        await SeedRateAsync("INR", "MYR", 0.0533m);

        var conversion = await NewService().ResolveConversionAsync("INR", "MYR");
        var result = NewEngine().Evaluate(
            MyrProductRequiring(5000m),
            new Dictionary<string, object?> { ["monthly_income"] = 50000 },
            conversion);

        Assert.False(result.IsEligible);
        Assert.True(result.Currency.Converted);
        Assert.Equal(0.0533m, result.Currency.Rate);
    }

    [Fact]
    public async Task A_foreign_salary_that_is_genuinely_large_enough_still_qualifies()
    {
        // ₹120,000 is about RM 6,396 — over the gate. Conversion must not simply reject everything.
        await SeedCurrenciesAsync(("MYR", 2), ("INR", 2));
        await SeedRateAsync("INR", "MYR", 0.0533m);

        var conversion = await NewService().ResolveConversionAsync("INR", "MYR");
        var result = NewEngine().Evaluate(
            MyrProductRequiring(5000m),
            new Dictionary<string, object?> { ["monthly_income"] = 120000 },
            conversion);

        Assert.True(result.IsEligible);
    }

    [Fact]
    public async Task A_salary_already_in_the_product_currency_is_left_alone()
    {
        await SeedCurrenciesAsync(("MYR", 2));

        var conversion = await NewService().ResolveConversionAsync("MYR", "MYR");
        var result = NewEngine().Evaluate(
            MyrProductRequiring(5000m),
            new Dictionary<string, object?> { ["monthly_income"] = 8000 },
            conversion);

        Assert.True(result.IsEligible);
        Assert.False(result.Currency.Converted);
        Assert.Equal(1m, result.Currency.Rate);
    }

    [Fact]
    public async Task A_plain_number_field_is_never_scaled_by_an_exchange_rate()
    {
        // An age, a term in months or a count carries no currency. Scaling it would be nonsense — age 30
        // would become 1.6 under an INR->MYR rate and every age rule would break.
        await SeedCurrenciesAsync(("MYR", 2), ("INR", 2));
        await SeedRateAsync("INR", "MYR", 0.0533m);

        var product = MyrProductRequiring(5000m);
        product.EligibilityRules.EligibilityCriteria.Add(new EligibilityCriterion
        {
            CriterionId = "ELG_AGE", Field = "age", Operator = "GREATER_THAN_OR_EQUAL", Value = 21
        });

        var conversion = await NewService().ResolveConversionAsync("INR", "MYR");
        var result = NewEngine().Evaluate(
            product,
            new Dictionary<string, object?> { ["monthly_income"] = 200000, ["age"] = 30 },
            conversion);

        // Income converts to ~RM 10,660 and age stays 30, so both gates pass.
        Assert.True(result.IsEligible);
    }

    // ---------------------------------------------------------------- rate resolution

    [Fact]
    public async Task The_newest_rate_at_or_before_today_is_the_one_applied()
    {
        await SeedCurrenciesAsync(("MYR", 2), ("INR", 2));
        await SeedRateAsync("INR", "MYR", 0.0600m, daysAgo: 30);
        await SeedRateAsync("INR", "MYR", 0.0533m, daysAgo: 1);

        var conversion = await NewService().ResolveConversionAsync("INR", "MYR");

        Assert.Equal(0.0533m, conversion.Rate);
    }

    [Fact]
    public async Task A_rate_dated_in_the_future_is_not_applied_yet()
    {
        await SeedCurrenciesAsync(("MYR", 2), ("INR", 2));
        await SeedRateAsync("INR", "MYR", 0.0533m, daysAgo: 1);
        await SeedRateAsync("INR", "MYR", 0.9999m, daysAgo: -7);

        var conversion = await NewService().ResolveConversionAsync("INR", "MYR");

        Assert.Equal(0.0533m, conversion.Rate);
    }

    [Fact]
    public async Task The_reverse_pair_is_inverted_when_no_direct_rate_exists()
    {
        // Maintaining MYR->INR also serves INR->MYR, halving what a treasury desk has to keep current.
        await SeedCurrenciesAsync(("MYR", 2), ("INR", 2));
        await SeedRateAsync("MYR", "INR", 20m);

        var conversion = await NewService().ResolveConversionAsync("INR", "MYR");

        Assert.True(conversion.IsConverting);
        Assert.Equal(0.05m, conversion.Rate);
    }

    [Fact]
    public async Task A_direct_rate_is_preferred_over_inverting_the_reverse_one()
    {
        await SeedCurrenciesAsync(("MYR", 2), ("INR", 2));
        await SeedRateAsync("MYR", "INR", 20m);
        await SeedRateAsync("INR", "MYR", 0.0533m);

        var conversion = await NewService().ResolveConversionAsync("INR", "MYR");

        Assert.Equal(0.0533m, conversion.Rate);
    }

    // ---------------------------------------------------------------- the missing-rate case

    [Fact]
    public async Task A_missing_rate_reports_the_gap_rather_than_failing_the_evaluation()
    {
        // An evaluation that completes and says "this figure was not converted" is more useful than no
        // evaluation at all — but it must say so, or the outcome reads as a clean decision.
        await SeedCurrenciesAsync(("MYR", 2), ("JPY", 0));

        var conversion = await NewService().ResolveConversionAsync("JPY", "MYR");

        Assert.False(conversion.IsConverting);
        Assert.NotNull(conversion.UnavailableReason);
        Assert.Contains("JPY", conversion.UnavailableReason);

        var result = NewEngine().Evaluate(
            MyrProductRequiring(5000m),
            new Dictionary<string, object?> { ["monthly_income"] = 8000 },
            conversion);

        Assert.NotNull(result.Currency.UnavailableReason);
    }

    // ---------------------------------------------------------------- rounding

    [Fact]
    public async Task A_converted_amount_is_rounded_to_the_target_currency_minor_units()
    {
        await SeedCurrenciesAsync(("MYR", 2), ("INR", 2));
        await SeedRateAsync("INR", "MYR", 0.05333m);

        var conversion = await NewService().ResolveConversionAsync("INR", "MYR");

        // 50,000 * 0.05333 = 2666.5 exactly; MYR has two minor units.
        Assert.Equal(2666.50m, conversion.ToBase(50000m));
    }

    [Fact]
    public async Task A_zero_decimal_currency_converts_to_a_whole_number()
    {
        // ¥1,234.56 is not a representable sum of money. Rounding has to follow the TARGET currency.
        await SeedCurrenciesAsync(("JPY", 0), ("MYR", 2));
        await SeedRateAsync("MYR", "JPY", 33.7m);

        var conversion = await NewService().ResolveConversionAsync("MYR", "JPY");

        Assert.Equal(0, conversion.DecimalPlaces);
        Assert.Equal(3370m, conversion.ToBase(100m));
        Assert.Equal(Math.Floor(conversion.ToBase(123.45m)), conversion.ToBase(123.45m));
    }

    [Fact]
    public async Task An_unspecified_submission_currency_is_taken_as_the_product_currency()
    {
        // Most submissions will omit it, and the product's own currency is the only sane reading.
        await SeedCurrenciesAsync(("MYR", 2));

        var conversion = await NewService().ResolveConversionAsync(null, "MYR");

        Assert.False(conversion.IsConverting);
        Assert.Null(conversion.UnavailableReason);
        Assert.Equal("MYR", conversion.SubmittedCurrency);
    }

    // ---------------------------------------------------------------- rate maintenance

    [Fact]
    public async Task Saving_the_same_pair_and_date_twice_corrects_the_rate_rather_than_adding_a_second()
    {
        // Two rates for one day would make "the rate we used" ambiguous, defeating the audit trail.
        await SeedCurrenciesAsync(("MYR", 2), ("INR", 2));
        var service = NewService();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        await service.UpsertRateAsync(new() { FromCurrency = "INR", ToCurrency = "MYR", Rate = 0.05m, EffectiveFrom = today });
        await service.UpsertRateAsync(new() { FromCurrency = "INR", ToCurrency = "MYR", Rate = 0.0533m, EffectiveFrom = today });

        var rates = await service.GetRatesAsync("MYR");

        Assert.Equal(0.0533m, Assert.Single(rates).Rate);
    }

    [Fact]
    public async Task A_rate_against_an_unknown_currency_is_refused()
    {
        await SeedCurrenciesAsync(("MYR", 2));

        await Assert.ThrowsAsync<ProductMarketplace.Api.Exceptions.ValidationException>(
            () => NewService().UpsertRateAsync(new() { FromCurrency = "XXX", ToCurrency = "MYR", Rate = 1m }));
    }

    [Fact]
    public async Task A_currency_cannot_have_a_rate_against_itself()
    {
        await SeedCurrenciesAsync(("MYR", 2));

        await Assert.ThrowsAsync<ProductMarketplace.Api.Exceptions.ValidationException>(
            () => NewService().UpsertRateAsync(new() { FromCurrency = "MYR", ToCurrency = "MYR", Rate = 1m }));
    }

    [Fact]
    public async Task A_rate_reports_its_age_so_a_stale_table_is_visible()
    {
        // A maintained rate table fails quietly: an out-of-date rate produces a confidently wrong
        // decision with no error anywhere. The age is what lets an operator notice.
        await SeedCurrenciesAsync(("MYR", 2), ("INR", 2));
        await SeedRateAsync("INR", "MYR", 0.0533m, daysAgo: 45);

        var rate = Assert.Single(await NewService().GetRatesAsync("MYR"));

        Assert.Equal(45, rate.AgeInDays);
        Assert.True(rate.IsCurrent);
    }
}
