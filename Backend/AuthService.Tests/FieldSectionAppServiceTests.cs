using AuthService.Application.DTOs;
using AuthService.Application.Exceptions;
using AuthService.Application.Services;
using AuthService.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// The section catalog decides where every field on the user form is drawn, so its guards are worth
/// pinning: a duplicate label would put two identical headings on the form, a deleted default section
/// would leave unresolvable fields nowhere to land, and a delete that silently re-homed fields would
/// rearrange a form the admin never touched. The resolver tests cover the read-time upgrade of schemas
/// written back when a section was free text.
/// </summary>
public class FieldSectionAppServiceTests : IDisposable
{
    private readonly AuthDbContext db;
    private readonly FieldSectionAppService service;

    public FieldSectionAppServiceTests()
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"field-sections-{Guid.NewGuid()}")
            .Options;

        db = new AuthDbContext(options);
        service = new FieldSectionAppService(db, TestAudit.For(db));
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    private static FieldSectionDto Section(string key, string label, int order) => new(key, label, order);

    private static UpdateFieldSectionCatalogRequest Request(params FieldSectionDto[] sections) => new(sections);

    // ---------------------------------------------------------------- reads

    [Fact]
    public async Task GetAsync_on_an_empty_database_returns_the_three_default_sections_with_personal_details_as_system()
    {
        var result = await service.GetAsync();

        Assert.Equal(["Personal Details", "Address", "Additional Details"], result.Sections.Select(s => s.Label));
        var system = Assert.Single(result.Sections, s => s.IsSystem);
        Assert.Equal(FieldSectionAppService.SystemSectionKey, system.Key);
        Assert.Equal(0, result.Version);
    }

    // ---------------------------------------------------------------- writes

    [Fact]
    public async Task UpdateAsync_on_a_fresh_database_creates_version_1_and_slugs_a_missing_key_from_the_label()
    {
        var result = await service.UpdateAsync(Request(
            Section("personal-details", "Personal Details", 1),
            Section("", "Employment Details", 2)), actingUserId: null);

        Assert.Equal(1, result.Version);
        Assert.Equal("employment-details", result.Sections[1].Key);
    }

    [Fact]
    public async Task UpdateAsync_renumbers_order_from_position_so_gaps_and_duplicates_cannot_survive()
    {
        var result = await service.UpdateAsync(Request(
            Section("address", "Address", 40),
            Section("personal-details", "Personal Details", 5),
            Section("extra", "Extra", 5)), actingUserId: null);

        // Sorted by the requested order (5, 5, 40 — ties keep request order), then renumbered 1..n.
        Assert.Equal(["personal-details", "extra", "address"], result.Sections.Select(s => s.Key));
        Assert.Equal([1, 2, 3], result.Sections.Select(s => s.Order));
    }

    [Fact]
    public async Task UpdateAsync_gives_a_colliding_generated_key_a_numeric_suffix_instead_of_rejecting_it()
    {
        var result = await service.UpdateAsync(Request(
            Section("personal-details", "Personal Details", 1),
            Section("address", "Address", 2),
            Section("", "Address!", 3)), actingUserId: null);

        Assert.Equal(["personal-details", "address", "address-2"], result.Sections.Select(s => s.Key));
    }

    [Fact]
    public async Task UpdateAsync_increments_the_version_on_each_save()
    {
        var first = await service.UpdateAsync(Request(Section("personal-details", "Personal Details", 1)), null);
        var second = await service.UpdateAsync(Request(Section("personal-details", "Personal Details", 1)), null);

        Assert.Equal(1, first.Version);
        Assert.Equal(2, second.Version);
    }

    [Fact]
    public async Task UpdateAsync_with_a_stale_expected_version_is_refused_as_a_conflict()
    {
        await service.UpdateAsync(Request(Section("personal-details", "Personal Details", 1)), null);

        await Assert.ThrowsAsync<ConflictAppException>(() => service.UpdateAsync(
            new UpdateFieldSectionCatalogRequest([Section("personal-details", "Personal Details", 1)], ExpectedVersion: 0),
            actingUserId: null));
    }

    [Fact]
    public async Task UpdateAsync_marks_only_the_personal_details_key_as_system_whatever_the_client_sent()
    {
        var result = await service.UpdateAsync(Request(
            new FieldSectionDto("personal-details", "Personal Details", 1, IsSystem: false),
            new FieldSectionDto("address", "Address", 2, IsSystem: true)), actingUserId: null);

        Assert.True(result.Sections.Single(s => s.Key == "personal-details").IsSystem);
        Assert.False(result.Sections.Single(s => s.Key == "address").IsSystem);
    }

    // ---------------------------------------------------------------- guards

    [Fact]
    public async Task UpdateAsync_rejects_an_empty_section_list()
    {
        await Assert.ThrowsAsync<ValidationAppException>(() => service.UpdateAsync(Request(), null));
    }

    [Fact]
    public async Task UpdateAsync_rejects_two_sections_that_share_a_label_ignoring_case()
    {
        var ex = await Assert.ThrowsAsync<ValidationAppException>(() => service.UpdateAsync(Request(
            Section("personal-details", "Personal Details", 1),
            Section("a", "Address", 2),
            Section("b", "ADDRESS", 3)), null));

        Assert.Contains("already a section named", ex.Message);
    }

    [Fact]
    public async Task UpdateAsync_rejects_a_blank_section_name()
    {
        await Assert.ThrowsAsync<ValidationAppException>(() => service.UpdateAsync(Request(
            Section("personal-details", "Personal Details", 1),
            Section("x", "   ", 2)), null));
    }

    [Fact]
    public async Task UpdateAsync_rejects_a_catalog_that_drops_the_default_section()
    {
        var ex = await Assert.ThrowsAsync<ValidationAppException>(() => service.UpdateAsync(Request(
            Section("address", "Address", 1)), null));

        Assert.Contains("default section", ex.Message);
    }

    [Fact]
    public async Task UpdateAsync_lets_the_default_section_be_renamed_because_only_its_key_is_load_bearing()
    {
        var result = await service.UpdateAsync(Request(
            Section("personal-details", "About the User", 1)), null);

        Assert.Equal("About the User", result.Sections[0].Label);
    }

    // ---------------------------------------------------------------- deleting a section that holds fields

    private async Task SeedFieldsAsync(params FieldDefinitionDto[] fields)
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

    private static FieldDefinitionDto CustomField(string key, string section) =>
        new(key, key, false, "text", false, 1, [], Section: section);

    [Fact]
    public async Task Deleting_a_section_that_still_holds_fields_without_a_destination_is_refused_and_names_the_section()
    {
        await service.UpdateAsync(Request(
            Section("personal-details", "Personal Details", 1),
            Section("employment", "Employment", 2)), null);
        await SeedFieldsAsync(CustomField("employer", "employment"));

        var ex = await Assert.ThrowsAsync<ValidationAppException>(() => service.UpdateAsync(Request(
            Section("personal-details", "Personal Details", 1)), null));

        Assert.Contains("Employment", ex.Message);
        Assert.Contains("move them", ex.Message);
    }

    [Fact]
    public async Task Deleting_a_section_with_a_destination_moves_its_fields_and_bumps_the_field_schema_version_together()
    {
        await service.UpdateAsync(Request(
            Section("personal-details", "Personal Details", 1),
            Section("employment", "Employment", 2)), null);
        await SeedFieldsAsync(CustomField("employer", "employment"), CustomField("nickname", "personal-details"));

        await service.UpdateAsync(new UpdateFieldSectionCatalogRequest(
            [Section("personal-details", "Personal Details", 1)],
            ReassignFieldsTo: new Dictionary<string, string> { ["employment"] = "personal-details" }), null);

        var schema = await new UserFieldSchemaAppService(db, TestAudit.For(db)).GetAsync();
        Assert.All(schema.Fields, f => Assert.Equal("personal-details", f.Section));
        Assert.Equal(2, schema.Version);
    }

    [Fact]
    public async Task Deleting_an_empty_section_needs_no_destination()
    {
        await service.UpdateAsync(Request(
            Section("personal-details", "Personal Details", 1),
            Section("empty", "Empty", 2)), null);

        var result = await service.UpdateAsync(Request(Section("personal-details", "Personal Details", 1)), null);

        Assert.Single(result.Sections);
    }

    [Fact]
    public async Task A_destination_that_is_not_in_the_new_catalog_does_not_satisfy_the_reassignment_requirement()
    {
        await service.UpdateAsync(Request(
            Section("personal-details", "Personal Details", 1),
            Section("employment", "Employment", 2)), null);
        await SeedFieldsAsync(CustomField("employer", "employment"));

        await Assert.ThrowsAsync<ValidationAppException>(() => service.UpdateAsync(new UpdateFieldSectionCatalogRequest(
            [Section("personal-details", "Personal Details", 1)],
            ReassignFieldsTo: new Dictionary<string, string> { ["employment"] = "ghost" }), null));
    }

    // ---------------------------------------------------------------- resolver

    private static readonly IReadOnlyList<FieldSectionDto> Catalog =
    [
        new("personal-details", "Personal Details", 1, true),
        new("address", "Address", 2),
    ];

    [Theory]
    [InlineData("address", "address")]
    [InlineData("ADDRESS", "address")]
    [InlineData("Address", "address")]
    [InlineData("  Address  ", "address")]
    [InlineData("personal details", "personal-details")]
    public void ResolveSectionKey_accepts_a_key_or_a_legacy_label_in_any_case(string stored, string expected)
    {
        Assert.Equal(expected, FieldSectionAppService.ResolveSectionKey(stored, Catalog));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("A Section Nobody Created")]
    public void ResolveSectionKey_falls_back_to_the_system_section_rather_than_throwing(string? stored)
    {
        Assert.Equal("personal-details", FieldSectionAppService.ResolveSectionKey(stored, Catalog));
    }

    [Theory]
    [InlineData(null, true)]
    [InlineData("", true)]
    [InlineData("address", true)]
    [InlineData("Address", true)]
    [InlineData("Nope", false)]
    public void IsKnownSection_is_lenient_about_blank_and_strict_about_unknown_names(string? stored, bool expected)
    {
        Assert.Equal(expected, FieldSectionAppService.IsKnownSection(stored, Catalog));
    }
}
