using AuthService.Infrastructure.Validation;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// The "Email address" preset's check — ported from the frontend's `email()` rule
/// (Frontend/apps/host/src/shared/validation/rules.ts) so a value it accepts or rejects there is judged
/// identically here. Two behaviours in one preset: a basic shape check, and a near-miss-domain check
/// that catches typos a plain shape check cannot ("gmail.comsssssssss" is a syntactically valid TLD).
/// </summary>
public class EmailSmartValidatorTests
{
    [Theory]
    [InlineData("jane@example.com")]
    [InlineData("jane.smith+work@example.co.uk")]
    [InlineData("jane@gmail.com")]
    public void A_well_formed_email_is_valid(string email)
    {
        Assert.True(EmailSmartValidator.IsValid(email));
    }

    [Theory]
    [InlineData("jane@example")] // no TLD
    [InlineData("not-an-email")]
    [InlineData("@example.com")] // no local part
    [InlineData("jane@@example.com")]
    public void A_malformed_email_is_invalid(string email)
    {
        Assert.False(EmailSmartValidator.IsValid(email));
    }

    [Theory]
    [InlineData("ashok246@gmail.comsssssssss")]
    [InlineData("jane@yahoo.co.injunk")]
    public void A_near_miss_of_a_common_domain_is_rejected_even_though_the_shape_is_syntactically_valid(string email)
    {
        // No regex can prove ".comsssssssss" is not a real TLD — it IS a well-formed label. This is
        // exactly the case the near-miss check exists for: nobody has ever meant to type this.
        Assert.False(EmailSmartValidator.IsValid(email));
    }

    [Theory]
    [InlineData("jane@gmail.com")]
    [InlineData("jane@googlemail.com")]
    [InlineData("jane@yahoo.co.in")]
    [InlineData("jane@rediffmail.com")]
    public void An_exact_match_of_a_common_domain_is_accepted(string email)
    {
        Assert.True(EmailSmartValidator.IsValid(email));
    }

    [Fact]
    public void A_domain_that_merely_contains_a_common_domain_as_a_substring_is_not_penalised()
    {
        // The near-miss check anchors on the common domain being a PREFIX with extra trailing
        // characters — a genuinely different, longer domain that happens to contain "gmail.com"
        // somewhere in the middle (not as its start) must not be wrongly flagged.
        Assert.True(EmailSmartValidator.IsValid("jane@mygmail.com.example.org"));
    }
}
