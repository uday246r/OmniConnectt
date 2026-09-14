using AuthService.Application.DTOs;
using AuthService.Application.Exceptions;
using AuthService.Application.Services;
using AuthService.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// CRUD + shape guards for the admin-configurable salutation list (Mr., Ms., ...) — see
/// SalutationCatalog's doc comment. UserAppService trusts this list as the source of truth when
/// validating a submitted Salutation, so a save that leaves the list empty or duplicated would make
/// every subsequent user create/update either impossible or ambiguous.
/// </summary>
public class SalutationAppServiceTests : IDisposable
{
    private readonly AuthDbContext db;
    private readonly SalutationAppService service;

    public SalutationAppServiceTests()
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"salutations-{Guid.NewGuid()}")
            .Options;

        db = new AuthDbContext(options);
        service = new SalutationAppService(db, TestAudit.For(db));
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public async Task GetAsync_on_an_empty_database_returns_the_default_starter_list()
    {
        var result = await service.GetAsync();

        Assert.Equal(["Mr.", "Ms.", "Mrs.", "Dr."], result.Salutations);
    }

    [Fact]
    public async Task GetSalutationsAsync_returns_just_the_list_without_the_version_wrapper()
    {
        var salutations = await service.GetSalutationsAsync();

        Assert.NotEmpty(salutations);
    }

    [Fact]
    public async Task UpdateAsync_on_a_fresh_database_creates_the_row_at_version_1()
    {
        var result = await service.UpdateAsync(new UpdateSalutationCatalogRequest(["Mr.", "Ms.", "Prof."]), actingUserId: null);

        Assert.Equal(1, result.Version);
        Assert.Equal(["Mr.", "Ms.", "Prof."], result.Salutations);
    }

    [Fact]
    public async Task UpdateAsync_on_an_existing_row_increments_the_version_instead_of_duplicating_it()
    {
        await service.UpdateAsync(new UpdateSalutationCatalogRequest(["Mr.", "Ms."]), actingUserId: null);

        var second = await service.UpdateAsync(new UpdateSalutationCatalogRequest(["Mr.", "Ms.", "Dr."]), actingUserId: null);

        Assert.Equal(2, second.Version);
        Assert.Equal(1, await db.SalutationCatalogs.CountAsync());
    }

    [Fact]
    public async Task Leading_and_trailing_whitespace_is_trimmed_before_saving()
    {
        var result = await service.UpdateAsync(new UpdateSalutationCatalogRequest(["  Mr.  ", "Ms."]), actingUserId: null);

        Assert.Equal("Mr.", result.Salutations[0]);
    }

    [Fact]
    public async Task Blank_entries_are_dropped_rather_than_saved_as_empty_strings()
    {
        var result = await service.UpdateAsync(new UpdateSalutationCatalogRequest(["Mr.", "   ", "Ms."]), actingUserId: null);

        Assert.Equal(["Mr.", "Ms."], result.Salutations);
    }

    [Fact]
    public async Task An_empty_list_after_trimming_blanks_is_rejected()
    {
        var ex = await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateAsync(new UpdateSalutationCatalogRequest(["   ", ""]), actingUserId: null));

        Assert.Contains("At least one salutation", ex.Message);
    }

    [Fact]
    public async Task A_salutation_longer_than_20_characters_is_rejected()
    {
        var tooLong = new string('x', 21);

        var ex = await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateAsync(new UpdateSalutationCatalogRequest([tooLong]), actingUserId: null));

        Assert.Contains("cannot exceed 20 characters", ex.Message);
    }

    [Fact]
    public async Task A_case_insensitive_duplicate_is_rejected()
    {
        // "Mr." and "MR." would be indistinguishable in a dropdown — this must be caught as the same
        // duplicate a user would perceive it as, not just an exact string match.
        var ex = await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateAsync(new UpdateSalutationCatalogRequest(["Mr.", "MR."]), actingUserId: null));

        Assert.Contains("duplicate entry", ex.Message);
    }

    [Fact]
    public async Task A_saved_list_round_trips_through_GetAsync_exactly()
    {
        await service.UpdateAsync(new UpdateSalutationCatalogRequest(["Mr.", "Ms.", "Mrs.", "Dr.", "Prof."]), actingUserId: null);

        var reloaded = await service.GetAsync();

        Assert.Equal(["Mr.", "Ms.", "Mrs.", "Dr.", "Prof."], reloaded.Salutations);
    }
}
