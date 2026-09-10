using AuthService.Infrastructure.Validation;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// The fixed, code-defined preset catalog admins pick from in Manage Fields — mirrors
/// Frontend/packages/ui/src/validation/fieldPresets.ts. Every preset id here has to keep matching its
/// frontend counterpart exactly, or a value the browser accepts (or rejects) disagrees with what the
/// server does with the same submission.
/// </summary>
public class FieldPresetsTests
{
    [Theory]
    [InlineData(FieldPresets.LettersOnly, "Jane", true)]
    [InlineData(FieldPresets.LettersOnly, "Jane2", false)]
    [InlineData(FieldPresets.LettersOnly, "Jane Doe", false)]
    [InlineData(FieldPresets.LettersAndSpaces, "Jane Doe", true)]
    [InlineData(FieldPresets.LettersAndSpaces, "Jane-Doe", false)]
    [InlineData(FieldPresets.Alphanumeric, "EMP1234", true)]
    [InlineData(FieldPresets.Alphanumeric, "EMP-1234", false)]
    [InlineData(FieldPresets.NoSpecialCharacters, "Room 4B", true)]
    [InlineData(FieldPresets.NoSpecialCharacters, "Room #4B!", false)]
    [InlineData(FieldPresets.DigitsOnly, "12345", true)]
    [InlineData(FieldPresets.DigitsOnly, "123-45", false)]
    [InlineData(FieldPresets.PanFormat, "ABCDE1234F", true)]
    [InlineData(FieldPresets.PanFormat, "ABCDE1234", false)]
    [InlineData(FieldPresets.Pincode, "400001", true)]
    [InlineData(FieldPresets.Pincode, "4000", false)]
    public void Built_in_regex_presets_match_exactly_what_the_label_promises(string presetId, string value, bool shouldMatch)
    {
        var found = FieldPresets.TryGetRegex(presetId, out var regex);

        Assert.True(found);
        Assert.Equal(shouldMatch, regex.IsMatch(value));
    }

    [Theory]
    [InlineData("1234 5678 9012", true)] // space-grouped in fours, as the Manage Formats hint tells the admin to expect
    [InlineData("123456789012", true)]   // ungrouped is also accepted
    [InlineData("1234-5678-9012", false)]
    [InlineData("12345678901", false)] // 11 digits — one short
    public void Aadhar_format_accepts_12_digits_optionally_space_grouped_in_fours(string value, bool shouldMatch)
    {
        FieldPresets.TryGetRegex(FieldPresets.AadharFormat, out var regex);

        Assert.Equal(shouldMatch, regex.IsMatch(value));
    }

    [Fact]
    public void An_unknown_preset_id_is_not_found_rather_than_throwing()
    {
        // UserSchemaValidator relies on this: a preset id that only exists in a stale/newer catalog
        // (frontend and backend momentarily out of sync) must fail open, never crash the request.
        var found = FieldPresets.TryGetRegex("somePresetThatWasNeverAdded", out _);

        Assert.False(found);
    }

    [Theory]
    [InlineData("+91 98765 43210", true)]
    [InlineData("098765-43210", true)]
    [InlineData("(022) 2222 3333", true)]
    [InlineData("1", false)] // too few digits to be dialable
    [InlineData("12345678901234567890", false)] // exceeds E.164's 15-digit cap
    [InlineData("abc-def-ghij", false)]
    public void Mobile_default_shape_is_digit_count_bounded_not_just_character_checked(string value, bool shouldMatch)
    {
        // The old rule only validated the alphabet, so "1" and a 40-digit string both passed. This is
        // the exact regression this shape check exists to prevent — see the doc comment on
        // FieldPresets.MobileInDefaultShape.
        Assert.Equal(shouldMatch, FieldPresets.MobileInDefaultShape.IsMatch(value));
    }

    [Theory]
    [InlineData("https://example.com", true)]
    [InlineData("http://example.com/path?query=1", true)]
    [InlineData("ftp://example.com", false)] // not http/https
    [InlineData("javascript:alert(1)", false)] // the exact XSS-shaped input this check exists to reject
    [InlineData("example.com", false)] // no scheme at all
    public void Absolute_url_check_requires_http_or_https_specifically(string value, bool shouldBeValid)
    {
        Assert.Equal(shouldBeValid, FieldPresets.IsAbsoluteUrl(value));
    }
}
