using AuthService.Application.DTOs;
using AuthService.Application.Exceptions;
using AuthService.Application.Services;
using AuthService.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace AuthService.Tests;

public class FieldTemplateAppServiceTests : IDisposable
{
    private readonly AuthDbContext db;
    private readonly FieldTemplateAppService service;

    public FieldTemplateAppServiceTests()
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"field-templates-{Guid.NewGuid()}")
            .Options;

        db = new AuthDbContext(options);
        service = new FieldTemplateAppService(db, TestAudit.For(db));
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public async Task GetAsync_on_empty_database_returns_default_templates_including_all_countries()
    {
        var result = await service.GetAsync();

        Assert.NotEmpty(result.Templates);
        var countryTemplate = result.Templates.FirstOrDefault(t => t.Id == "contact-country");
        Assert.NotNull(countryTemplate);
        Assert.Equal("dropdown", countryTemplate.DataType);
        Assert.True(countryTemplate.IsSystem);
        Assert.NotNull(countryTemplate.Options);
        Assert.Equal(196, countryTemplate.Options.Count);
        Assert.Contains("India", countryTemplate.Options);
        Assert.Contains("United States", countryTemplate.Options);
    }

    [Fact]
    public async Task UpdateAsync_on_fresh_database_creates_version_1()
    {
        var templates = new List<FieldTemplateDto>
        {
            new("custom-branches", "Office Branches", "Branch", "organization", "dropdown",
                Options: ["New York", "London", "Singapore"], IsSystem: false)
        };

        var result = await service.UpdateAsync(new UpdateFieldTemplateCatalogRequest(templates), actingUserId: null);

        Assert.Equal(1, result.Version);
        Assert.Single(result.Templates);
        Assert.Equal("Office Branches", result.Templates[0].Name);
    }

    [Fact]
    public async Task UpdateAsync_increments_version_on_subsequent_saves()
    {
        var initial = new List<FieldTemplateDto>
        {
            new("tmpl-1", "T1", "Label1", "general", "text", IsSystem: false)
        };
        await service.UpdateAsync(new UpdateFieldTemplateCatalogRequest(initial), actingUserId: null);

        var updated = new List<FieldTemplateDto>
        {
            new("tmpl-1", "T1", "Label1", "general", "text", IsSystem: false),
            new("tmpl-2", "T2", "Label2", "custom", "dropdown", Options: ["Opt A", "Opt B"], IsSystem: false)
        };
        var res2 = await service.UpdateAsync(new UpdateFieldTemplateCatalogRequest(updated, ExpectedVersion: 1), actingUserId: null);

        Assert.Equal(2, res2.Version);
        Assert.Equal(2, res2.Templates.Count);
    }

    [Fact]
    public async Task UpdateAsync_with_stale_expected_version_throws_conflict()
    {
        var initial = new List<FieldTemplateDto>
        {
            new("tmpl-1", "T1", "Label1", "general", "text", IsSystem: false)
        };
        await service.UpdateAsync(new UpdateFieldTemplateCatalogRequest(initial), actingUserId: null);

        await Assert.ThrowsAsync<ConflictAppException>(() =>
            service.UpdateAsync(new UpdateFieldTemplateCatalogRequest(initial, ExpectedVersion: 999), actingUserId: null));
    }

    [Fact]
    public async Task UpdateAsync_with_empty_template_list_throws_validation_error()
    {
        await Assert.ThrowsAsync<ValidationAppException>(() =>
            service.UpdateAsync(new UpdateFieldTemplateCatalogRequest([]), actingUserId: null));
    }

    [Fact]
    public async Task UpdateAsync_with_dropdown_having_zero_options_throws_validation_error()
    {
        var invalid = new List<FieldTemplateDto>
        {
            new("tmpl-dropdown", "Drop", "Drop", "general", "dropdown", Options: [], IsSystem: false)
        };

        await Assert.ThrowsAsync<ValidationAppException>(() =>
            service.UpdateAsync(new UpdateFieldTemplateCatalogRequest(invalid), actingUserId: null));
    }

    [Fact]
    public async Task UpdateAsync_trims_and_deduplicates_options()
    {
        var templates = new List<FieldTemplateDto>
        {
            new("custom-colors", "Colors", "Color", "custom", "dropdown",
                Options: ["  Red  ", "Blue", "red", "  Green  "], IsSystem: false)
        };

        var result = await service.UpdateAsync(new UpdateFieldTemplateCatalogRequest(templates), actingUserId: null);

        Assert.Equal(["Red", "Blue", "Green"], result.Templates[0].Options);
    }

    [Fact]
    public async Task Dynamic_cascading_templates_like_state_and_city_are_allowed_with_null_options()
    {
        var templates = new List<FieldTemplateDto>
        {
            new("contact-state", "State / Province", "State / Province", "contact", "dropdown", Options: null, IsSystem: true),
            new("contact-city", "City", "City", "contact", "dropdown", Options: null, IsSystem: true),
        };

        var result = await service.UpdateAsync(new UpdateFieldTemplateCatalogRequest(templates), actingUserId: null);

        Assert.Equal(2, result.Templates.Count);
        Assert.Null(result.Templates[0].Options);
        Assert.Null(result.Templates[1].Options);
    }

    [Fact]
    public async Task Contact_postal_code_template_is_seeded()
    {
        var result = await service.GetAsync();
        var postalTemplate = result.Templates.FirstOrDefault(t => t.Id == "contact-postal-code");

        Assert.NotNull(postalTemplate);
        Assert.Equal("text", postalTemplate.DataType);
        Assert.Equal("Postal / ZIP Code", postalTemplate.Label);
    }
}
