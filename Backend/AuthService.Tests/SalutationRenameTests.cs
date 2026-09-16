using System.Text.Json;
using AuthService.Application.DTOs;
using AuthService.Application.Exceptions;
using AuthService.Application.Services;
using AuthService.Domain.Entities;
using AuthService.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// Editing a salutation in Manage Fields.
/// </summary>
/// <remarks>
/// <para>
/// Salutations could only be added or removed. Correcting "Mr" to "Mr." therefore meant removing "Mr"
/// and adding "Mr." — every user holding "Mr" kept it, and since it was no longer allowed, none of those
/// users could be saved again until someone changed their title by hand.
/// </para>
/// <para>
/// These pin a real rename: the list, every profile holding the old value (deleted ones included), and
/// any pending approval that would set the old value all change together; one audit row says so in
/// words; two administrators saving at once cannot silently undo each other; and older rows stored as
/// plain strings keep working.
/// </para>
/// </remarks>
public class SalutationRenameTests : IDisposable
{
    private readonly AuthDbContext db = TestDb.Create("salutation-rename");
    private readonly SalutationAppService service;
    private static readonly Guid Admin = Guid.NewGuid();

    public SalutationRenameTests()
    {
        service = new SalutationAppService(db, TestAudit.For(db));
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    private async Task<User> UserWith(string? salutation, bool deleted = false)
    {
        var user = new User { Id = Guid.NewGuid(), Name = $"User {Guid.NewGuid():N}"[..12], Email = $"{Guid.NewGuid():N}@example.com", Salutation = salutation, IsDeleted = deleted };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    private async Task<SalutationCatalogDto> Seed(params string[] values) =>
        await service.UpdateAsync(new UpdateSalutationCatalogRequest(values), Admin);

    private static IReadOnlyList<SalutationEntryDto> Renamed(SalutationCatalogDto catalog, string from, string to) =>
        catalog.Entries!.Select(e => e.Value == from ? e with { Value = to } : e).ToList();

    [Fact]
    public async Task Renaming_changes_every_user_profile_that_shows_the_old_value()
    {
        var catalog = await Seed("Mr", "Ms.");
        var a = await UserWith("Mr");
        var b = await UserWith("Mr");
        var other = await UserWith("Ms.");

        var result = await service.UpdateAsync(new UpdateSalutationCatalogRequest(null, Renamed(catalog, "Mr", "Mr."), catalog.Version), Admin);

        db.ChangeTracker.Clear();
        Assert.Equal(["Mr.", "Ms."], result.Salutations);
        Assert.Equal("Mr.", (await db.Users.FindAsync(a.Id))!.Salutation);
        Assert.Equal("Mr.", (await db.Users.FindAsync(b.Id))!.Salutation);
        Assert.Equal("Ms.", (await db.Users.FindAsync(other.Id))!.Salutation);
        Assert.Equal(Admin, (await db.Users.FindAsync(a.Id))!.UpdatedBy);
    }

    [Fact]
    public async Task A_deleted_user_is_renamed_too_so_restoring_them_does_not_bring_the_old_title_back()
    {
        var catalog = await Seed("Mr");
        var deleted = await UserWith("Mr", deleted: true);

        await service.UpdateAsync(new UpdateSalutationCatalogRequest(null, Renamed(catalog, "Mr", "Mr."), catalog.Version), Admin);

        db.ChangeTracker.Clear();
        Assert.Equal("Mr.", (await db.Users.IgnoreQueryFilters().SingleAsync(u => u.Id == deleted.Id)).Salutation);
    }

    [Fact]
    public async Task A_pending_approval_that_would_set_the_old_title_now_sets_the_new_one()
    {
        var catalog = await Seed("Mr");
        var snapshot = new UserSnapshotDto("Ravi", "ravi@example.com", null, null, null, true, [], Salutation: "Mr");
        var pending = new ApprovalRequest
        {
            Id = Guid.NewGuid(), Module = ApprovalModuleKeys.Users, Action = "Create", NewDataJson = JsonSerializer.Serialize(snapshot),
            Status = ApprovalStatus.Pending, MakerId = Admin, CheckerId = Guid.NewGuid(),
        };
        db.ApprovalRequests.Add(pending);
        await db.SaveChangesAsync();

        await service.UpdateAsync(new UpdateSalutationCatalogRequest(null, Renamed(catalog, "Mr", "Mr."), catalog.Version), Admin);

        db.ChangeTracker.Clear();
        var replayed = JsonSerializer.Deserialize<UserSnapshotDto>((await db.ApprovalRequests.FindAsync(pending.Id))!.NewDataJson)!;
        Assert.Equal("Mr.", replayed.Salutation);
        Assert.Equal("Ravi", replayed.Name);
    }

    [Fact]
    public async Task The_rename_is_recorded_once_in_plain_words()
    {
        var catalog = await Seed("Mr", "Dr.");
        await UserWith("Mr");
        await UserWith("Mr");

        await service.UpdateAsync(new UpdateSalutationCatalogRequest(null, Renamed(catalog, "Mr", "Mr."), catalog.Version), Admin);

        var row = await db.AuditLogs.SingleAsync(a => a.Action == "salutation_catalog.renamed");
        Assert.Equal("Renamed the salutation 'Mr' to 'Mr.'. 2 user profiles now show 'Mr.'.", row.Details);
        Assert.Equal(Admin, row.ActorUserId);
    }

    [Fact]
    public async Task Additions_and_removals_are_described_rather_than_dumped_as_a_list()
    {
        var catalog = await Seed("Mr.", "Mrs.");
        var next = catalog.Entries!.Where(e => e.Value != "Mrs.").Append(new SalutationEntryDto("", "Prof.")).ToList();

        await service.UpdateAsync(new UpdateSalutationCatalogRequest(null, next, catalog.Version), Admin);

        var row = await db.AuditLogs.OrderByDescending(a => a.OccurredAt).FirstAsync(a => a.Action == "salutation_catalog.updated");
        Assert.StartsWith("Added 'Prof.'. Removed 'Mrs.'.", row.Details);
    }

    [Fact]
    public async Task A_save_based_on_an_older_version_is_refused_instead_of_undoing_someone_elses_change()
    {
        var loaded = await Seed("Mr", "Ms.");
        await service.UpdateAsync(new UpdateSalutationCatalogRequest(null, Renamed(loaded, "Ms.", "Ms"), loaded.Version), Admin);

        var stale = new UpdateSalutationCatalogRequest(null, Renamed(loaded, "Mr", "Mr."), loaded.Version);

        await Assert.ThrowsAsync<ConflictAppException>(() => service.UpdateAsync(stale, Admin));
    }

    [Fact]
    public async Task Each_entry_reports_how_many_users_show_it()
    {
        await Seed("Mr.", "Dr.");
        await UserWith("Dr.");
        await UserWith("Dr.");
        await UserWith("Dr.", deleted: true);

        var catalog = await service.GetAsync();

        Assert.Equal(2, catalog.Entries!.Single(e => e.Value == "Dr.").UserCount);
        Assert.Equal(0, catalog.Entries!.Single(e => e.Value == "Mr.").UserCount);
    }

    [Fact]
    public async Task A_list_stored_before_ids_existed_is_read_with_stable_ids_and_saved_in_the_new_shape()
    {
        db.SalutationCatalogs.Add(new SalutationCatalog { Id = Guid.NewGuid(), SalutationsJson = """["Mr","Ms."]""", Version = 3, UpdatedAt = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync();
        var holder = await UserWith("Mr");

        var first = await service.GetAsync();
        var second = await service.GetAsync();
        Assert.Equal(first.Entries!.Select(e => e.Id), second.Entries!.Select(e => e.Id));

        await service.UpdateAsync(new UpdateSalutationCatalogRequest(null, Renamed(first, "Mr", "Mr."), 3), Admin);

        db.ChangeTracker.Clear();
        Assert.Equal("Mr.", (await db.Users.FindAsync(holder.Id))!.Salutation);
        Assert.Contains("\"id\"", (await db.SalutationCatalogs.SingleAsync()).SalutationsJson);
    }

    [Fact]
    public async Task A_plain_list_from_an_older_caller_keeps_existing_entries_and_renames_nothing()
    {
        await Seed("Mr", "Ms.");
        var holder = await UserWith("Mr");

        await service.UpdateAsync(new UpdateSalutationCatalogRequest(["Mr", "Ms.", "Dr."]), Admin);

        db.ChangeTracker.Clear();
        Assert.Equal("Mr", (await db.Users.FindAsync(holder.Id))!.Salutation);
        Assert.DoesNotContain(db.AuditLogs, a => a.Action == "salutation_catalog.renamed");
    }

    [Fact]
    public async Task Renaming_to_a_value_already_in_the_list_is_refused()
    {
        var catalog = await Seed("Mr", "Mr.");

        await Assert.ThrowsAsync<ValidationAppException>(() =>
            service.UpdateAsync(new UpdateSalutationCatalogRequest(null, Renamed(catalog, "Mr", "mr."), catalog.Version), Admin));
    }
}
