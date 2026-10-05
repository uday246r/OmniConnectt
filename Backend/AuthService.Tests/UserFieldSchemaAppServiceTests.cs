using AuthService.Application.DTOs;
using AuthService.Application.Exceptions;
using AuthService.Application.Services;
using AuthService.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// CRUD + the shape guards for the admin-configurable "Manage Fields" schema — see
/// UserFieldSchemaAppService's own doc comment. The guards matter more than ordinary validation: this
/// schema is read on every Create/Edit User render, so a corrupt save here breaks that whole page, not
/// just the save that caused it.
/// </summary>
public class UserFieldSchemaAppServiceTests : IDisposable
{
    private readonly AuthDbContext db;
    private readonly UserFieldSchemaAppService service;

    public UserFieldSchemaAppServiceTests()
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"fieldschema-{Guid.NewGuid()}")
            .Options;

        db = new AuthDbContext(options);
        service = new UserFieldSchemaAppService(db, TestAudit.For(db));
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    private static FieldDefinitionDto CoreField(string key, string label, string dataType, int order) =>
        new(key, label, true, dataType, true, order, []);

    private static IReadOnlyList<FieldDefinitionDto> DefaultCoreFields() =>
    [
        CoreField("name", "Full Name", "text", 1),
        CoreField("email", "Email Address", "email", 2),
        CoreField("phoneNumber", "Mobile Number", "text", 3),
    ];

    // ---------------------------------------------------------------- reads

    [Fact]
    public async Task GetAsync_on_an_empty_database_returns_the_default_three_core_fields()
    {
        // AuthDbSeeder normally seeds this row at startup, but a fresh/unseeded database must still
        // hand the Create User form something sane, not a 500 or a blank form.
        var result = await service.GetAsync();

        Assert.Equal(3, result.Fields.Count);
        Assert.Contains(result.Fields, f => f.Key == "name" && f.Core);
        Assert.Contains(result.Fields, f => f.Key == "email" && f.Core);
        Assert.Contains(result.Fields, f => f.Key == "phoneNumber" && f.Core);
    }

    [Fact]
    public async Task GetFieldsAsync_returns_just_the_field_list_without_the_version_wrapper()
    {
        var fields = await service.GetFieldsAsync();

        Assert.Equal(3, fields.Count);
    }

    // ---------------------------------------------------------------- writes

    [Fact]
    public async Task UpdateAsync_on_a_fresh_database_creates_the_row_at_version_1()
    {
        var custom = new FieldDefinitionDto("aadharNumber", "Aadhar Number", false, "text", false, 4, []);
        var fields = DefaultCoreFields().Append(custom).ToList();

        var result = await service.UpdateAsync(new UpdateUserFieldSchemaRequest(fields), actingUserId: Guid.NewGuid());

        Assert.Equal(1, result.Version);
        Assert.Equal(4, result.Fields.Count);
    }

    [Fact]
    public async Task UpdateAsync_on_an_existing_row_increments_the_version_instead_of_duplicating_it()
    {
        await service.UpdateAsync(new UpdateUserFieldSchemaRequest(DefaultCoreFields()), actingUserId: null);

        var second = await service.UpdateAsync(new UpdateUserFieldSchemaRequest(DefaultCoreFields()), actingUserId: null);

        Assert.Equal(2, second.Version);
        Assert.Equal(1, await db.UserFieldSchemas.CountAsync());
    }

    [Fact]
    public async Task A_saved_custom_field_round_trips_through_GetAsync_exactly()
    {
        var custom = new FieldDefinitionDto(
            "aadharNumber", "Aadhar Number", false, "text", true, 4,
            [new ValidationRuleDto("aadharFormat", null, null, "Enter a valid 12-digit Aadhar number.")]);
        var fields = DefaultCoreFields().Append(custom).ToList();

        await service.UpdateAsync(new UpdateUserFieldSchemaRequest(fields), actingUserId: null);
        var reloaded = await service.GetAsync();

        var saved = Assert.Single(reloaded.Fields, f => f.Key == "aadharNumber");
        Assert.False(saved.Core);
        Assert.True(saved.Required);
        Assert.Single(saved.Validations);
        Assert.Equal("aadharFormat", saved.Validations[0].Type);
    }

    // ---------------------------------------------------------------- shape guards

    [Fact]
    public async Task An_empty_field_list_is_rejected()
    {
        var ex = await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateAsync(new UpdateUserFieldSchemaRequest([]), actingUserId: null));

        Assert.Contains("At least one field", ex.Message);
    }

    [Fact]
    public async Task Removing_a_reserved_core_key_is_rejected()
    {
        // The create/edit-user form must always be able to collect Name/Email/Mobile — those back
        // real, non-nullable-in-practice User columns.
        var withoutEmail = DefaultCoreFields().Where(f => f.Key != "email").ToList();

        var ex = await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateAsync(new UpdateUserFieldSchemaRequest(withoutEmail), actingUserId: null));

        Assert.Contains("'email'", ex.Message);
    }

    [Fact]
    public async Task A_custom_field_may_not_claim_to_be_core()
    {
        var bogusCore = new FieldDefinitionDto("aadharNumber", "Aadhar Number", true, "text", true, 4, []);
        var fields = DefaultCoreFields().Append(bogusCore).ToList();

        var ex = await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateAsync(new UpdateUserFieldSchemaRequest(fields), actingUserId: null));

        Assert.Contains("cannot be marked as a core field", ex.Message);
    }

    [Fact]
    public async Task A_field_using_a_reserved_key_must_be_marked_core()
    {
        // Prevents a schema where "email" exists but isn't wired to the real User.Email column —
        // that would silently desync the form from what actually gets stored.
        var fields = new List<FieldDefinitionDto>
        {
            CoreField("name", "Full Name", "text", 1),
            new("email", "Email Address", false, "email", true, 2, []), // Core: false — invalid
            CoreField("phoneNumber", "Mobile Number", "text", 3),
        };

        var ex = await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateAsync(new UpdateUserFieldSchemaRequest(fields), actingUserId: null));

        Assert.Contains("reserved core field name", ex.Message);
    }

    [Fact]
    public async Task Duplicate_field_keys_are_rejected()
    {
        var duplicate = new FieldDefinitionDto("name", "Full Name (dup)", false, "text", false, 4, []);
        var fields = DefaultCoreFields().Append(duplicate).ToList();

        var ex = await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateAsync(new UpdateUserFieldSchemaRequest(fields), actingUserId: null));

        Assert.Contains("used more than once", ex.Message);
    }

    [Fact]
    public async Task An_invalid_custom_regex_on_a_field_rule_is_rejected_at_save_time()
    {
        // Caught here rather than only at submission time, so a broken pattern never makes it into
        // the schema every future Create User form renders against.
        var badField = new FieldDefinitionDto(
            "code", "Code", false, "text", false, 4,
            [new ValidationRuleDto("custom", "[unclosed", null, "Bad pattern.")]);
        var fields = DefaultCoreFields().Append(badField).ToList();

        var ex = await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateAsync(new UpdateUserFieldSchemaRequest(fields), actingUserId: null));

        Assert.Contains("invalid custom pattern", ex.Message);
    }

    [Fact]
    public async Task A_custom_rule_of_type_custom_with_no_pattern_is_rejected()
    {
        var badField = new FieldDefinitionDto(
            "code", "Code", false, "text", false, 4,
            [new ValidationRuleDto("custom", null, null, "Bad rule.")]);
        var fields = DefaultCoreFields().Append(badField).ToList();

        var ex = await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateAsync(new UpdateUserFieldSchemaRequest(fields), actingUserId: null));

        Assert.Contains("no pattern", ex.Message);
    }

    [Fact]
    public async Task A_field_key_check_is_case_insensitive_so_Email_and_email_still_collide()
    {
        var shoutyDuplicate = new FieldDefinitionDto("EMAIL", "Email (dup)", false, "text", false, 4, []);
        var fields = DefaultCoreFields().Append(shoutyDuplicate).ToList();

        await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateAsync(new UpdateUserFieldSchemaRequest(fields), actingUserId: null));
    }

    [Fact]
    public async Task A_dropdown_field_with_options_is_saved_and_retrieved()
    {
        var countryField = new FieldDefinitionDto(
            "country", "Country", false, "dropdown", true, 4, [],
            Options: ["India", "United States", "United Kingdom"], Template: "country");
        var fields = DefaultCoreFields().Append(countryField).ToList();

        var result = await service.UpdateAsync(new UpdateUserFieldSchemaRequest(fields), actingUserId: null);

        var retrieved = Assert.Single(result.Fields, f => f.Key == "country");
        Assert.Equal("dropdown", retrieved.DataType);
        Assert.NotNull(retrieved.Options);
        Assert.Equal(3, retrieved.Options.Count);
        Assert.Equal("country", retrieved.Template);
    }

    [Fact]
    public async Task A_dropdown_field_without_options_is_rejected()
    {
        var emptyDropdown = new FieldDefinitionDto(
            "customTag", "Custom Tag", false, "dropdown", true, 4, [], Options: []);
        var fields = DefaultCoreFields().Append(emptyDropdown).ToList();

        var ex = await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateAsync(new UpdateUserFieldSchemaRequest(fields), actingUserId: null));

        Assert.Contains("must have at least one option", ex.Message);
    }

    [Fact]
    public async Task A_dynamic_cascading_dropdown_such_as_state_is_allowed_without_options()
    {
        var stateDropdown = new FieldDefinitionDto(
            "stateProvince", "State / Province", false, "dropdown", true, 4, [], Options: [], Template: "contact-state");
        var fields = DefaultCoreFields().Append(stateDropdown).ToList();

        var result = await service.UpdateAsync(new UpdateUserFieldSchemaRequest(fields), actingUserId: null);

        var retrieved = Assert.Single(result.Fields, f => f.Key == "stateProvince");
        Assert.Equal("dropdown", retrieved.DataType);
        Assert.NotNull(retrieved.Options);
        Assert.Empty(retrieved.Options);
    }

    [Fact]
    public async Task A_core_field_cannot_be_a_dropdown()
    {
        var badCore = new FieldDefinitionDto(
            "name", "Full Name", true, "dropdown", true, 1, [], Options: ["Alice", "Bob"]);
        var fields = new List<FieldDefinitionDto>
        {
            badCore,
            new("email", "Email", true, "email", true, 2, []),
            new("phoneNumber", "Phone", true, "text", true, 3, []),
        };

        var ex = await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateAsync(new UpdateUserFieldSchemaRequest(fields), actingUserId: null));

        Assert.Contains("cannot be a dropdown", ex.Message);
    }

    [Fact]
    public void System_text_json_deserializes_incoming_update_request_with_options_and_template()
    {
        var json = """
        {
            "fields": [
                {
                    "key": "name",
                    "label": "Full Name",
                    "core": true,
                    "dataType": "text",
                    "required": true,
                    "order": 1,
                    "validations": []
                },
                {
                    "key": "country",
                    "label": "Country",
                    "core": false,
                    "dataType": "dropdown",
                    "required": true,
                    "order": 2,
                    "validations": [],
                    "options": ["India", "United States", "Germany"],
                    "template": "contact-country"
                }
            ],
            "expectedVersion": 1
        }
        """;

        var request = System.Text.Json.JsonSerializer.Deserialize<UpdateUserFieldSchemaRequest>(
            json, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));

        Assert.NotNull(request);
        Assert.Equal(2, request.Fields.Count);
        var country = Assert.Single(request.Fields, f => f.Key == "country");
        Assert.NotNull(country.Options);
        Assert.Equal(3, country.Options.Count);
        Assert.Equal("contact-country", country.Template);
    }

    // ---------------------------------------------------------------- sections

    private static FieldDefinitionDto InSection(string key, int order, string? section) =>
        new(key, key, false, "text", false, order, [], Section: section);

    private async Task SeedSectionsAsync(params FieldSectionDto[] sections)
    {
        await new FieldSectionAppService(db, TestAudit.For(db))
            .UpdateAsync(new UpdateFieldSectionCatalogRequest(sections), actingUserId: null);
    }

    /// <summary>Writes a schema row exactly as an older build would have — bypassing UpdateAsync, which
    /// now canonicalises sections on save and so can no longer produce a legacy row.</summary>
    private async Task SeedLegacyRowAsync(params FieldDefinitionDto[] fields)
    {
        db.UserFieldSchemas.Add(new AuthService.Domain.Entities.UserFieldSchema
        {
            Id = Guid.NewGuid(),
            SchemaJson = System.Text.Json.JsonSerializer.Serialize(fields,
                new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web)),
            Version = 1,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task GetAsync_upgrades_a_legacy_section_label_to_its_key_without_rewriting_the_stored_row()
    {
        // Schemas saved while a section was free text carry the LABEL ("Address"). Reads must resolve
        // that to the catalog key so every consumer sees one identity, with no data migration.
        await SeedLegacyRowAsync([.. DefaultCoreFields(), InSection("street", 4, "Address")]);

        var result = await service.GetAsync();

        Assert.Equal("address", result.Fields.Single(f => f.Key == "street").Section);
        Assert.Contains("\"Address\"", (await db.UserFieldSchemas.SingleAsync()).SchemaJson);
    }

    [Fact]
    public async Task GetAsync_places_a_field_whose_section_no_longer_exists_in_the_system_section()
    {
        await SeedLegacyRowAsync([.. DefaultCoreFields(), InSection("legacy", 4, "Long Gone")]);

        var result = await service.GetAsync();

        Assert.Equal("personal-details", result.Fields.Single(f => f.Key == "legacy").Section);
    }

    [Fact]
    public async Task UpdateAsync_rejects_a_field_naming_a_section_that_does_not_exist()
    {
        var ex = await Assert.ThrowsAsync<ValidationAppException>(() => service.UpdateAsync(
            new UpdateUserFieldSchemaRequest([.. DefaultCoreFields(), InSection("employer", 4, "employment")]), null));

        Assert.Contains("section that no longer exists", ex.Message);
    }

    [Fact]
    public async Task UpdateAsync_accepts_a_section_by_label_and_stores_the_key()
    {
        var result = await service.UpdateAsync(
            new UpdateUserFieldSchemaRequest([.. DefaultCoreFields(), InSection("street", 4, "Address")]), null);

        Assert.Equal("address", result.Fields.Single(f => f.Key == "street").Section);
    }

    [Fact]
    public async Task UpdateAsync_renumbers_order_per_section_and_lays_fields_out_in_section_order()
    {
        await SeedSectionsAsync(
            new FieldSectionDto("personal-details", "Personal Details", 1),
            new FieldSectionDto("address", "Address", 2));

        // Sent deliberately interleaved and with a global-looking order — the way the old single
        // sequence looked. Per-section 1..n is what makes "move up" mean something inside a group.
        var result = await service.UpdateAsync(new UpdateUserFieldSchemaRequest(
        [
            InSection("street", 7, "address"),
            .. DefaultCoreFields(),
            InSection("city", 9, "address"),
            InSection("nickname", 5, "personal-details"),
        ]), null);

        Assert.Equal(["name", "email", "phoneNumber", "nickname", "street", "city"], result.Fields.Select(f => f.Key));
        Assert.Equal([1, 2, 3, 4], result.Fields.Where(f => f.Section == "personal-details").Select(f => f.Order));
        Assert.Equal([1, 2], result.Fields.Where(f => f.Section == "address").Select(f => f.Order));
    }

    [Fact]
    public async Task UpdateAsync_lets_a_field_move_between_sections_by_changing_only_its_section()
    {
        await SeedSectionsAsync(
            new FieldSectionDto("personal-details", "Personal Details", 1),
            new FieldSectionDto("address", "Address", 2));
        await service.UpdateAsync(new UpdateUserFieldSchemaRequest([.. DefaultCoreFields(), InSection("street", 4, "personal-details")]), null);

        var result = await service.UpdateAsync(new UpdateUserFieldSchemaRequest([.. DefaultCoreFields(), InSection("street", 4, "address")]), null);

        var street = result.Fields.Single(f => f.Key == "street");
        Assert.Equal("address", street.Section);
        Assert.Equal(1, street.Order);
    }

    [Fact]
    public async Task GetAsync_puts_an_address_shaped_field_with_no_stored_section_under_address_as_the_old_form_did()
    {
        await SeedLegacyRowAsync([.. DefaultCoreFields(), InSection("country", 4, null), InSection("nickname", 5, null)]);

        var result = await service.GetAsync();

        Assert.Equal("address", result.Fields.Single(f => f.Key == "country").Section);
        Assert.Equal("personal-details", result.Fields.Single(f => f.Key == "nickname").Section);
    }

    [Fact]
    public async Task GetAsync_never_lets_the_legacy_address_guess_override_an_explicit_section()
    {
        await SeedSectionsAsync(
            new FieldSectionDto("personal-details", "Personal Details", 1),
            new FieldSectionDto("address", "Address", 2),
            new FieldSectionDto("employment", "Employment", 3));
        await SeedLegacyRowAsync([.. DefaultCoreFields(), InSection("country", 4, "employment")]);

        var result = await service.GetAsync();

        Assert.Equal("employment", result.Fields.Single(f => f.Key == "country").Section);
    }

    [Fact]
    public async Task GetAsync_matches_legacy_address_keys_exactly_so_estate_is_not_state()
    {
        await SeedLegacyRowAsync([.. DefaultCoreFields(), InSection("estate", 4, null)]);

        var result = await service.GetAsync();

        Assert.Equal("personal-details", result.Fields.Single(f => f.Key == "estate").Section);
    }

    [Fact]
    public async Task GetAsync_stops_guessing_address_once_that_section_has_been_deleted()
    {
        await SeedSectionsAsync(new FieldSectionDto("personal-details", "Personal Details", 1));
        await SeedLegacyRowAsync([.. DefaultCoreFields(), InSection("city", 4, null)]);

        var result = await service.GetAsync();

        Assert.Equal("personal-details", result.Fields.Single(f => f.Key == "city").Section);
    }
}
