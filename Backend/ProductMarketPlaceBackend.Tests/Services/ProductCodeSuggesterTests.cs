using ProductMarketplace.Api.Services;

namespace ProductMarketplace.Api.Tests.Services;

/// <summary>
/// Covers the product-code suggestion offered when creating a product.
/// </summary>
/// <remarks>
/// A suggestion rather than a generated id, because a product code is a meaningful bank-assigned
/// identifier that reaches statements and reporting — but a blank box produced exactly the inconsistency
/// this database already shows (PC_PLATINUM_01 beside EDU-LOAN beside HL_01). The behaviour that matters
/// is that accepting the suggestion is always safe: it must never collide with a code already in use.
/// </remarks>
public class ProductCodeSuggesterTests
{
    [Fact]
    public void A_multi_word_category_becomes_an_initialism_and_the_name_supplies_the_body()
    {
        var code = ProductCodeSuggester.Suggest("CREDIT_CARD", "Platinum Rewards Card", []);

        // "Card" is dropped as a noise word — it adds length without distinguishing anything.
        Assert.Equal("CC-PLATINUM-REWARDS-01", code);
    }

    [Fact]
    public void A_single_word_category_is_kept_whole_because_one_letter_reads_as_nothing()
    {
        var code = ProductCodeSuggester.Suggest("LOANS", "Personal Loan", []);

        Assert.Equal("LOANS-PERSONAL-LOAN-01", code);
    }

    [Fact]
    public void A_code_already_in_use_is_skipped_so_accepting_the_suggestion_is_always_safe()
    {
        var existing = new[] { "CC-PLATINUM-REWARDS-01", "CC-PLATINUM-REWARDS-02" };

        var code = ProductCodeSuggester.Suggest("CREDIT_CARD", "Platinum Rewards Card", existing);

        Assert.Equal("CC-PLATINUM-REWARDS-03", code);
    }

    [Fact]
    public void Collision_checking_ignores_case_because_codes_are_stored_upper_cased()
    {
        var code = ProductCodeSuggester.Suggest("CREDIT_CARD", "Platinum Rewards", ["cc-platinum-rewards-01"]);

        Assert.Equal("CC-PLATINUM-REWARDS-02", code);
    }

    [Fact]
    public void A_suggestion_is_always_numbered_even_when_nothing_would_collide()
    {
        // Two products of the same name in one category is ordinary; an unnumbered stem would collide the
        // moment the second is created.
        var code = ProductCodeSuggester.Suggest("SAVINGS_ACCOUNT", "Everyday Saver", []);

        Assert.EndsWith("-01", code);
    }

    [Theory]
    [InlineData("platinumRewards", "CC-PLATINUM-REWARDS-01")]
    [InlineData("Platinum  Rewards", "CC-PLATINUM-REWARDS-01")]
    [InlineData("Platinum-Rewards", "CC-PLATINUM-REWARDS-01")]
    [InlineData("platinum rewards!!", "CC-PLATINUM-REWARDS-01")]
    public void A_name_is_tokenized_on_case_and_punctuation_alike(string name, string expected)
    {
        Assert.Equal(expected, ProductCodeSuggester.Suggest("CREDIT_CARD", name, []));
    }

    [Fact]
    public void Only_the_first_few_name_words_are_used_so_the_code_stays_readable()
    {
        var code = ProductCodeSuggester.Suggest("LOANS", "Premium Secured Residential Property Financing", []);

        Assert.Equal("LOANS-PREMIUM-SECURED-RESIDENTIAL-01", code);
    }

    [Fact]
    public void A_name_made_entirely_of_noise_words_keeps_them_rather_than_producing_nothing()
    {
        var code = ProductCodeSuggester.Suggest("CREDIT_CARD", "The Card", []);

        Assert.Equal("CC-THE-CARD-01", code);
    }

    [Fact]
    public void A_missing_category_still_produces_a_usable_code_from_the_name_alone()
    {
        var code = ProductCodeSuggester.Suggest(null, "Platinum Rewards", []);

        Assert.Equal("PLATINUM-REWARDS-01", code);
    }

    [Fact]
    public void A_missing_name_still_produces_a_usable_code_from_the_category_alone()
    {
        var code = ProductCodeSuggester.Suggest("CREDIT_CARD", null, []);

        Assert.Equal("CC-01", code);
    }

    [Fact]
    public void With_neither_category_nor_name_a_placeholder_is_returned_rather_than_an_empty_string()
    {
        Assert.Equal("PRODUCT-01", ProductCodeSuggester.Suggest(null, null, []));
    }

    [Fact]
    public void A_suggestion_never_exceeds_the_fifty_character_column_limit()
    {
        var code = ProductCodeSuggester.Suggest(
            "EXTREMELY_LONG_CATEGORY_NAME_HERE",
            "Extraordinarily Comprehensive Premium Financing Solution",
            []);

        Assert.True(code.Length <= 50, $"code was {code.Length} characters: {code}");
        Assert.DoesNotContain("--", code);
    }
}
