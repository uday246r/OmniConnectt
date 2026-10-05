using AuthService.Application.DTOs;
using AuthService.Infrastructure.Validation;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// The server-side re-validation of a create/update-user submission against the CURRENT
/// admin-defined UserFieldSchema and "Manage Formats" custom preset catalog — the mirror of the
/// frontend's AJV-backed compileFieldValidator. This is what stops a direct API call (skipping the
/// browser entirely) from bypassing whatever validation an admin configured.
/// </summary>
public class UserSchemaValidatorTests
{
    private readonly UserSchemaValidator validator = new();

    private static FieldDefinitionDto Field(
        string key, string label, bool core, bool required, params ValidationRuleDto[] rules) =>
        new(key, label, core, "text", required, 1, rules);

    private static ValidationRuleDto Rule(string type, string message, string? pattern = null, int? value = null) =>
        new(type, pattern, value, message);

    // ---------------------------------------------------------------- required-ness

    [Fact]
    public void A_required_field_left_empty_fails_with_a_message_naming_the_field()
    {
        var fields = new[] { Field("aadharNumber", "Aadhar Number", core: false, required: true) };
        var values = new Dictionary<string, string?> { ["aadharNumber"] = "" };

        var errors = validator.Validate(fields, values);

        var error = Assert.Single(errors);
        Assert.Equal("aadharNumber", error.FieldKey);
        Assert.Equal("Aadhar Number is required.", error.Message);
    }

    [Fact]
    public void An_optional_field_left_empty_has_no_rules_applied_to_nothing_entered()
    {
        var fields = new[]
        {
            Field("nickname", "Nickname", core: false, required: false,
                Rule(FieldPresets.LettersOnly, "Letters only.")),
        };
        var values = new Dictionary<string, string?> { ["nickname"] = "" };

        var errors = validator.Validate(fields, values);

        Assert.Empty(errors);
    }

    [Fact]
    public void A_core_field_is_always_required_regardless_of_its_Required_flag()
    {
        // Core fields' required-ness is enforced by CreateUserRequest/UpdateUserRequest's fixed data
        // annotations, never by the schema — so even a (malformed) core field marked Required:false
        // must not be treated as optional here.
        var fields = new[] { Field("name", "Full Name", core: true, required: false) };
        var values = new Dictionary<string, string?> { ["name"] = "" };

        var errors = validator.Validate(fields, values);

        Assert.Empty(errors);
    }

    // ---------------------------------------------------------------- built-in presets

    [Fact]
    public void A_value_that_fails_a_built_in_preset_reports_that_rules_message()
    {
        var fields = new[]
        {
            Field("name", "Full Name", core: true, required: true,
                Rule(FieldPresets.LettersAndSpaces, "Only letters and spaces are allowed.")),
        };
        var values = new Dictionary<string, string?> { ["name"] = "Jane2" };

        var errors = validator.Validate(fields, values);

        var error = Assert.Single(errors);
        Assert.Equal("Only letters and spaces are allowed.", error.Message);
    }

    [Fact]
    public void A_value_that_passes_every_rule_produces_no_errors()
    {
        var fields = new[]
        {
            Field("name", "Full Name", core: true, required: true,
                Rule(FieldPresets.LettersAndSpaces, "Only letters and spaces are allowed.")),
        };
        var values = new Dictionary<string, string?> { ["name"] = "Jane Doe" };

        var errors = validator.Validate(fields, values);

        Assert.Empty(errors);
    }

    [Fact]
    public void Only_the_first_failing_rule_on_a_field_is_reported()
    {
        // Mirrors the frontend's firstError() — a non-technical admin reading three stacked errors on
        // one field at once is worse UX than fixing them one at a time.
        var fields = new[]
        {
            Field("code", "Employee Code", core: false, required: true,
                Rule(FieldPresets.LettersOnly, "Letters only."),
                Rule(FieldPresets.MaxLength, "Too long.", value: 3)),
        };
        var values = new Dictionary<string, string?> { ["code"] = "TOOLONG123" }; // fails BOTH rules

        var errors = validator.Validate(fields, values);

        var error = Assert.Single(errors);
        Assert.Equal("Letters only.", error.Message);
    }

    // ---------------------------------------------------------------- email / mobile builtins

    [Fact]
    public void EmailSmart_rejects_a_near_miss_domain_the_same_way_the_frontend_preset_does()
    {
        var fields = new[]
        {
            Field("email", "Email Address", core: true, required: true,
                Rule(FieldPresets.EmailSmart, "Enter a valid email address.")),
        };
        var values = new Dictionary<string, string?> { ["email"] = "ashok@gmail.comsssssssss" };

        var errors = validator.Validate(fields, values);

        Assert.Single(errors);
    }

    [Fact]
    public void MobileIN_accepts_a_number_valid_for_its_own_country()
    {
        var fields = new[]
        {
            Field("phoneNumber", "Mobile Number", core: true, required: true,
                Rule(FieldPresets.MobileIN, "Enter a valid mobile number.")),
        };
        var values = new Dictionary<string, string?> { ["phoneNumber"] = "+91 98765 43210" };

        var errors = validator.Validate(fields, values);

        Assert.Empty(errors);
    }

    // ---------------------------------------------------------------- length presets

    [Theory]
    [InlineData(FieldPresets.MinLength, 5, "ab", false)]
    [InlineData(FieldPresets.MinLength, 5, "abcde", true)]
    [InlineData(FieldPresets.MaxLength, 5, "abcdef", false)]
    [InlineData(FieldPresets.MaxLength, 5, "abcde", true)]
    [InlineData(FieldPresets.ExactLength, 5, "abcd", false)]
    [InlineData(FieldPresets.ExactLength, 5, "abcde", true)]
    public void Length_presets_compare_against_the_rules_configured_bound(string presetType, int bound, string value, bool shouldPass)
    {
        var fields = new[]
        {
            Field("code", "Code", core: false, required: true,
                Rule(presetType, "Length rule failed.", value: bound)),
        };
        var values = new Dictionary<string, string?> { ["code"] = value };

        var errors = validator.Validate(fields, values);

        Assert.Equal(shouldPass, errors.Count == 0);
    }

    // ---------------------------------------------------------------- one-off custom regex

    [Fact]
    public void A_one_off_custom_regex_rule_is_applied_directly_from_the_field_definition()
    {
        var fields = new[]
        {
            Field("code", "Employee Code", core: false, required: true,
                Rule(FieldPresets.Custom, "Use format EMP-0001.", pattern: "^EMP-[0-9]{4}$")),
        };

        var badValues = new Dictionary<string, string?> { ["code"] = "EMP-1" };
        var goodValues = new Dictionary<string, string?> { ["code"] = "EMP-0001" };

        Assert.Single(validator.Validate(fields, badValues));
        Assert.Empty(validator.Validate(fields, goodValues));
    }

    [Fact]
    public void An_invalid_custom_regex_pattern_fails_open_rather_than_throwing()
    {
        // An admin-authored pattern that doesn't compile must never take down every submission on a
        // field that uses it — the builder's own live tester is where that should have been caught.
        var fields = new[]
        {
            Field("code", "Code", core: false, required: true,
                Rule(FieldPresets.Custom, "Invalid pattern.", pattern: "[unclosed")),
        };
        var values = new Dictionary<string, string?> { ["code"] = "anything" };

        var errors = validator.Validate(fields, values);

        Assert.Empty(errors);
    }

    // ---------------------------------------------------------------- unknown preset

    [Fact]
    public void An_unrecognised_preset_type_fails_open_instead_of_blocking_every_submission()
    {
        // A preset id that exists only in a newer/older catalog (frontend and backend momentarily out
        // of sync, or an admin-defined format that was since deleted) must never lock every admin out
        // of creating users on that field.
        var fields = new[]
        {
            Field("code", "Code", core: false, required: true,
                Rule("somePresetThatDoesNotExist", "Should never surface.")),
        };
        var values = new Dictionary<string, string?> { ["code"] = "anything" };

        var errors = validator.Validate(fields, values);

        Assert.Empty(errors);
    }

    // ---------------------------------------------------------------- Manage Formats custom presets

    [Fact]
    public void A_custom_regex_preset_from_Manage_Formats_is_resolved_by_key()
    {
        var fields = new[]
        {
            Field("code", "Employee Code", core: false, required: true,
                Rule("employeeCode", "Use format EMP-0001.")),
        };
        var customPresets = new[]
        {
            new CustomPresetDto("employeeCode", "Employee Code", "regex", "^EMP-[0-9]{4}$", null, null, null, null, "Use format EMP-0001."),
        };

        var badValues = new Dictionary<string, string?> { ["code"] = "EMP-1" };
        var goodValues = new Dictionary<string, string?> { ["code"] = "EMP-0001" };

        Assert.Single(validator.Validate(fields, badValues, customPresets));
        Assert.Empty(validator.Validate(fields, goodValues, customPresets));
    }

    [Theory]
    [InlineData("999", false)]  // below min
    [InlineData("1000", true)]
    [InlineData("5000", true)]
    [InlineData("5001", false)] // above max
    public void A_custom_numericRange_preset_bounds_the_value_as_a_number(string value, bool shouldPass)
    {
        var fields = new[]
        {
            Field("employeeId", "Employee ID", core: false, required: true,
                Rule("employeeIdRange", "Employee ID must be between 1000 and 5000.")),
        };
        var customPresets = new[]
        {
            new CustomPresetDto("employeeIdRange", "Employee ID Range", "numericRange", null, null, null, 1000m, 5000m,
                "Employee ID must be between 1000 and 5000."),
        };
        var values = new Dictionary<string, string?> { ["employeeId"] = value };

        var errors = validator.Validate(fields, values, customPresets);

        Assert.Equal(shouldPass, errors.Count == 0);
    }

    [Fact]
    public void A_custom_numericRange_preset_rejects_a_non_numeric_value()
    {
        var fields = new[]
        {
            Field("employeeId", "Employee ID", core: false, required: true,
                Rule("employeeIdRange", "Must be numeric and in range.")),
        };
        var customPresets = new[]
        {
            new CustomPresetDto("employeeIdRange", "Employee ID Range", "numericRange", null, null, null, 1000m, 5000m,
                "Must be numeric and in range."),
        };
        var values = new Dictionary<string, string?> { ["employeeId"] = "not-a-number" };

        var errors = validator.Validate(fields, values, customPresets);

        Assert.Single(errors);
    }

    [Theory]
    [InlineData("ab", false)]     // below min
    [InlineData("abcde", true)]
    [InlineData("abcdefghijk", false)] // above max
    public void A_custom_lengthRange_preset_bounds_the_character_count(string value, bool shouldPass)
    {
        var fields = new[]
        {
            Field("code", "Code", core: false, required: true, Rule("codeLength", "Wrong length.")),
        };
        var customPresets = new[]
        {
            new CustomPresetDto("codeLength", "Code Length", "lengthRange", null, 3, 8, null, null, "Wrong length."),
        };
        var values = new Dictionary<string, string?> { ["code"] = value };

        var errors = validator.Validate(fields, values, customPresets);

        Assert.Equal(shouldPass, errors.Count == 0);
    }

    [Theory]
    [InlineData("lettersOnly", "Jane", true)]
    [InlineData("lettersOnly", "Jane2", false)]
    [InlineData("digitsOnly", "12345", true)]
    [InlineData("digitsOnly", "12a45", false)]
    public void A_custom_textPattern_preset_applies_the_chosen_character_class(string textMode, string value, bool shouldPass)
    {
        var fields = new[]
        {
            Field("companyName", "Company Name", core: false, required: true, Rule("companyNameFormat", "Wrong format.")),
        };
        var customPresets = new[]
        {
            new CustomPresetDto("companyNameFormat", "Company Name Format", "textPattern", null, null, null, null, null,
                "Wrong format.", TextMode: textMode),
        };
        var values = new Dictionary<string, string?> { ["companyName"] = value };

        var errors = validator.Validate(fields, values, customPresets);

        Assert.Equal(shouldPass, errors.Count == 0);
    }

    [Fact]
    public void A_field_referencing_a_custom_preset_that_was_since_deleted_fails_open()
    {
        // An admin can delete a "Manage Formats" preset that's still referenced by an existing field's
        // rule — that stale reference must not brick every submission on that field.
        var fields = new[]
        {
            Field("code", "Code", core: false, required: true, Rule("deletedPreset", "Should never surface.")),
        };
        var values = new Dictionary<string, string?> { ["code"] = "anything" };

        var errors = validator.Validate(fields, values, customPresets: []);

        Assert.Empty(errors);
    }

    [Fact]
    public void A_dropdown_field_with_valid_option_passes_validation()
    {
        var fields = new[]
        {
            new FieldDefinitionDto("country", "Country", false, "dropdown", true, 4, [], Options: ["India", "United States", "Germany"]),
        };
        var values = new Dictionary<string, string?> { ["country"] = "india" };

        var errors = validator.Validate(fields, values);

        Assert.Empty(errors);
    }

    [Fact]
    public void A_dropdown_field_with_invalid_option_fails_validation()
    {
        var fields = new[]
        {
            new FieldDefinitionDto("country", "Country", false, "dropdown", true, 4, [], Options: ["India", "United States", "Germany"]),
        };
        var values = new Dictionary<string, string?> { ["country"] = "Atlantis" };

        var errors = validator.Validate(fields, values);

        var error = Assert.Single(errors);
        Assert.Equal("country", error.FieldKey);
        Assert.Equal("Please select a valid option for Country.", error.Message);
    }

    [Fact]
    public void An_optional_dropdown_field_left_empty_passes_validation()
    {
        var fields = new[]
        {
            new FieldDefinitionDto("country", "Country", false, "dropdown", false, 4, [], Options: ["India", "United States"]),
        };
        var values = new Dictionary<string, string?> { ["country"] = "" };

        var errors = validator.Validate(fields, values);

        Assert.Empty(errors);
    }
}

