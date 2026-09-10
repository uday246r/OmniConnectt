using AuthService.Application.DTOs;
using AuthService.Application.Exceptions;
using AuthService.Application.Services;
using AuthService.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// CRUD + the shape guards for the admin-defined "Manage Formats" catalog — see
/// ValidationPresetCatalog's doc comment. Unlike UserFieldSchema, an empty catalog is a perfectly
/// valid state (no custom formats yet, only the built-ins) — the guards here are about internal
/// consistency of whatever IS saved, not about requiring anything to exist.
/// </summary>
public class ValidationPresetAppServiceTests : IDisposable
{
    private readonly AuthDbContext db;
    private readonly ValidationPresetAppService service;

    public ValidationPresetAppServiceTests()
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"presets-{Guid.NewGuid()}")
            .Options;

        db = new AuthDbContext(options);
        service = new ValidationPresetAppService(db);
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    private static CustomPresetDto RegexPreset(string key, string pattern, string message = "Invalid.") =>
        new(key, key, "regex", pattern, null, null, null, null, message);

    // ---------------------------------------------------------------- reads

    [Fact]
    public async Task GetAsync_on_an_empty_database_returns_an_empty_catalog_not_an_error()
    {
        var result = await service.GetAsync();

        Assert.Empty(result.Presets);
        Assert.Equal(0, result.Version);
    }

    // ---------------------------------------------------------------- writes / round trip

    [Fact]
    public async Task An_empty_preset_list_is_a_valid_save()
    {
        var result = await service.UpdateAsync(new UpdateValidationPresetCatalogRequest([]), actingUserId: null);

        Assert.Equal(1, result.Version);
        Assert.Empty(result.Presets);
    }

    [Fact]
    public async Task UpdateAsync_on_an_existing_row_increments_the_version_instead_of_duplicating_it()
    {
        await service.UpdateAsync(new UpdateValidationPresetCatalogRequest([RegexPreset("empCode", "^EMP-[0-9]{4}$")]), actingUserId: null);

        var second = await service.UpdateAsync(
            new UpdateValidationPresetCatalogRequest([RegexPreset("empCode", "^EMP-[0-9]{4}$")]), actingUserId: null);

        Assert.Equal(2, second.Version);
        Assert.Equal(1, await db.ValidationPresetCatalogs.CountAsync());
    }

    [Fact]
    public async Task A_saved_numericRange_preset_round_trips_through_GetAsync_exactly()
    {
        var preset = new CustomPresetDto(
            "employeeIdRange", "Employee ID Range", "numericRange", null, null, null, 1000m, 5000m,
            "Employee ID must be between 1000 and 5000.");

        await service.UpdateAsync(new UpdateValidationPresetCatalogRequest([preset]), actingUserId: null);
        var reloaded = await service.GetAsync();

        var saved = Assert.Single(reloaded.Presets);
        Assert.Equal("numericRange", saved.Kind);
        Assert.Equal(1000m, saved.MinValue);
        Assert.Equal(5000m, saved.MaxValue);
    }

    // ---------------------------------------------------------------- shape guards — general

    [Fact]
    public async Task A_preset_with_no_label_is_rejected()
    {
        var preset = new CustomPresetDto("code", "", "regex", "^[A-Z]+$", null, null, null, null, "Invalid.");

        var ex = await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateAsync(new UpdateValidationPresetCatalogRequest([preset]), actingUserId: null));

        Assert.Contains("needs a label", ex.Message);
    }

    [Fact]
    public async Task Duplicate_preset_keys_are_rejected()
    {
        var fields = new[] { RegexPreset("empCode", "^EMP-[0-9]{4}$"), RegexPreset("empCode", "^DIFFERENT$") };

        var ex = await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateAsync(new UpdateValidationPresetCatalogRequest(fields), actingUserId: null));

        Assert.Contains("used more than once", ex.Message);
    }

    [Theory]
    [InlineData("lettersOnly")]
    [InlineData("emailSmart")]
    [InlineData("custom")]
    public async Task A_custom_format_may_not_reuse_a_built_in_preset_key(string builtinKey)
    {
        // Picking the same key as a built-in would make a field's rule ambiguous about which
        // catalog it resolves against.
        var preset = RegexPreset(builtinKey, "^[A-Z]+$");

        var ex = await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateAsync(new UpdateValidationPresetCatalogRequest([preset]), actingUserId: null));

        Assert.Contains("reserved built-in format name", ex.Message);
    }

    [Fact]
    public async Task An_unknown_kind_is_rejected()
    {
        var preset = new CustomPresetDto("weird", "Weird", "notARealKind", null, null, null, null, null, "Invalid.");

        var ex = await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateAsync(new UpdateValidationPresetCatalogRequest([preset]), actingUserId: null));

        Assert.Contains("unknown format type", ex.Message);
    }

    [Fact]
    public async Task A_preset_with_no_error_message_is_rejected()
    {
        var preset = new CustomPresetDto("code", "Code", "regex", "^[A-Z]+$", null, null, null, null, "");

        var ex = await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateAsync(new UpdateValidationPresetCatalogRequest([preset]), actingUserId: null));

        Assert.Contains("needs an error message", ex.Message);
    }

    // ---------------------------------------------------------------- shape guards — kind: regex

    [Fact]
    public async Task A_regex_kind_preset_with_no_pattern_is_rejected()
    {
        var preset = new CustomPresetDto("code", "Code", "regex", null, null, null, null, null, "Invalid.");

        var ex = await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateAsync(new UpdateValidationPresetCatalogRequest([preset]), actingUserId: null));

        Assert.Contains("needs a regular expression", ex.Message);
    }

    [Fact]
    public async Task A_regex_kind_preset_with_an_invalid_pattern_is_rejected_at_save_time()
    {
        var preset = RegexPreset("code", "[unclosed");

        var ex = await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateAsync(new UpdateValidationPresetCatalogRequest([preset]), actingUserId: null));

        Assert.Contains("invalid regular expression", ex.Message);
    }

    // ---------------------------------------------------------------- shape guards — kind: lengthRange

    [Fact]
    public async Task A_lengthRange_preset_needs_at_least_one_bound()
    {
        var preset = new CustomPresetDto("codeLength", "Code Length", "lengthRange", null, null, null, null, null, "Wrong length.");

        var ex = await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateAsync(new UpdateValidationPresetCatalogRequest([preset]), actingUserId: null));

        Assert.Contains("minimum and/or maximum length", ex.Message);
    }

    [Fact]
    public async Task A_lengthRange_preset_with_min_greater_than_max_is_rejected()
    {
        var preset = new CustomPresetDto("codeLength", "Code Length", "lengthRange", null, 10, 5, null, null, "Wrong length.");

        var ex = await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateAsync(new UpdateValidationPresetCatalogRequest([preset]), actingUserId: null));

        Assert.Contains("minimum length cannot exceed maximum length", ex.Message);
    }

    [Fact]
    public async Task A_lengthRange_preset_with_only_a_minimum_is_valid_open_ended_on_the_high_side()
    {
        var preset = new CustomPresetDto("codeLength", "Code Length", "lengthRange", null, 5, null, null, null, "Too short.");

        var result = await service.UpdateAsync(new UpdateValidationPresetCatalogRequest([preset]), actingUserId: null);

        Assert.Single(result.Presets);
    }

    // ---------------------------------------------------------------- shape guards — kind: numericRange

    [Fact]
    public async Task A_numericRange_preset_needs_at_least_one_bound()
    {
        var preset = new CustomPresetDto("range", "Range", "numericRange", null, null, null, null, null, "Out of range.");

        var ex = await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateAsync(new UpdateValidationPresetCatalogRequest([preset]), actingUserId: null));

        Assert.Contains("minimum and/or maximum value", ex.Message);
    }

    [Fact]
    public async Task A_numericRange_preset_with_min_greater_than_max_is_rejected()
    {
        var preset = new CustomPresetDto("range", "Range", "numericRange", null, null, null, 100m, 10m, "Out of range.");

        var ex = await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateAsync(new UpdateValidationPresetCatalogRequest([preset]), actingUserId: null));

        Assert.Contains("minimum value cannot exceed maximum value", ex.Message);
    }

    // ---------------------------------------------------------------- shape guards — kind: textPattern

    [Fact]
    public async Task A_textPattern_preset_needs_a_recognised_character_mode()
    {
        var preset = new CustomPresetDto("companyName", "Company Name", "textPattern", null, null, null, null, null, "Wrong format.", TextMode: null);

        var ex = await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateAsync(new UpdateValidationPresetCatalogRequest([preset]), actingUserId: null));

        Assert.Contains("valid character type", ex.Message);
    }

    [Fact]
    public async Task A_textPattern_preset_with_an_unrecognised_mode_string_is_rejected()
    {
        var preset = new CustomPresetDto("companyName", "Company Name", "textPattern", null, null, null, null, null, "Wrong format.", TextMode: "emoji");

        await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateAsync(new UpdateValidationPresetCatalogRequest([preset]), actingUserId: null));
    }

    [Theory]
    [InlineData("lettersOnly")]
    [InlineData("lettersAndSpaces")]
    [InlineData("alphanumeric")]
    [InlineData("noSpecialCharacters")]
    [InlineData("digitsOnly")]
    public async Task Every_documented_textPattern_mode_is_accepted(string mode)
    {
        var preset = new CustomPresetDto("companyName", "Company Name", "textPattern", null, null, null, null, null, "Wrong format.", TextMode: mode);

        var result = await service.UpdateAsync(new UpdateValidationPresetCatalogRequest([preset]), actingUserId: null);

        Assert.Single(result.Presets);
    }
}
