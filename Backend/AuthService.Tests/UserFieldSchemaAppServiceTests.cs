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
}
