using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// The Users directory's list, summary and Role options, answered by the database.
/// </summary>
/// <remarks>
/// The Users page used to fetch one page of users and filter, count and page it in the browser. The
/// endpoint caps a page at 100, so past 100 accounts the rest of the directory could not be found and
/// the cards counted a sample. These tests hold the server to what the page now relies on: every filter
/// narrows the whole directory, paging is stable across equal names, and the counts cover every user.
/// </remarks>
public class UserDirectoryQueryTests : IDisposable
{
    private readonly ApprovalHarness harness = new();
    private UserAppService Users => harness.Users;

    public void Dispose()
    {
        harness.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public async Task A_directory_larger_than_one_page_can_be_read_to_its_last_user()
    {
        await SeedManyAsync(count: 230, name: "Same Name");

        var seen = new HashSet<Guid>();
        for (var page = 1; page <= 3; page++)
        {
            var result = await Users.ListAsync(page, 100, new UserListFilter { Name = "same name" });
            foreach (var item in result.Items) seen.Add(item.Id);
            Assert.Equal(230, result.Total);
        }

        Assert.Equal(230, seen.Count);
    }

    [Fact]
    public async Task The_mobile_filter_matches_digits_regardless_of_how_the_number_was_formatted()
    {
        await AddUserAsync("Formatted", phone: "+60 12-345 6789");
        await AddUserAsync("Other", phone: "+1 555 000 1111");

        var result = await Users.ListAsync(1, 25, new UserListFilter { Phone = "60123" });

        Assert.Equal(["Formatted"], result.Items.Select(u => u.Name));
    }

    [Fact]
    public async Task Quick_search_finds_a_user_by_role_name_and_by_digits_of_their_number()
    {
        var auditors = await AddRoleAsync("Auditor");
        await AddUserAsync("Ravi", phone: "(022) 4455-6677", role: auditors);
        await AddUserAsync("Mina", phone: "9999");

        var byRole = await Users.ListAsync(1, 25, new UserListFilter { Search = "audit" });
        var byDigits = await Users.ListAsync(1, 25, new UserListFilter { Search = "4455 66" });

        Assert.Equal(["Ravi"], byRole.Items.Select(u => u.Name));
        Assert.Equal(["Ravi"], byDigits.Items.Select(u => u.Name));
    }

    [Fact]
    public async Task The_role_filter_accepts_a_role_name_or_No_Role()
    {
        var auditors = await AddRoleAsync("Auditor");
        await AddUserAsync("Ravi", role: auditors);
        await AddUserAsync("Unassigned");

        var auditorsOnly = await Users.ListAsync(1, 25, new UserListFilter { Role = "Auditor" });
        var noRole = await Users.ListAsync(1, 25, new UserListFilter { Role = UserAppService.NoRoleLabel });

        Assert.Equal(["Ravi"], auditorsOnly.Items.Select(u => u.Name));
        Assert.Equal(["Unassigned"], noRole.Items.Select(u => u.Name));
    }

    [Fact]
    public async Task A_last_sign_in_range_excludes_users_who_never_signed_in_and_those_outside_it()
    {
        var now = DateTimeOffset.UtcNow;
        await AddUserAsync("Recent", lastLogin: now.AddDays(-1));
        await AddUserAsync("Old", lastLogin: now.AddDays(-40));
        await AddUserAsync("Never");

        var result = await Users.ListAsync(1, 25, new UserListFilter { LastLoginFrom = now.AddDays(-7), LastLoginTo = now });

        Assert.Equal(["Recent"], result.Items.Select(u => u.Name));
    }

    [Fact]
    public async Task The_summary_counts_the_whole_directory_not_a_page_of_it()
    {
        var before = await Users.SummaryAsync();
        var admins = await AddRoleAsync("Platform Admin", isAdministrator: true);
        await SeedManyAsync(count: 120, name: "Bulk");
        await AddUserAsync("Dormant", status: UserStatus.Inactive);
        await AddUserAsync("Boss", role: admins);

        var summary = await Users.SummaryAsync();

        Assert.Equal(before.Total + 122, summary.Total);
        Assert.Equal(before.Active + 121, summary.Active);
        Assert.Equal(before.Inactive + 1, summary.Inactive);
        Assert.Equal(before.Administrators + 1, summary.Administrators);
    }

    [Fact]
    public async Task Role_options_list_every_held_role_plus_No_Role_and_ignore_the_role_filter_itself()
    {
        var auditors = await AddRoleAsync("Auditor");
        await AddUserAsync("Ravi", role: auditors);
        await AddUserAsync("Unassigned");

        var facets = await Users.FacetsAsync(new UserListFilter { Role = "Auditor" });

        Assert.Contains("Auditor", facets.Roles);
        Assert.Contains(UserAppService.NoRoleLabel, facets.Roles);
    }

    // ---------------------------------------------------------------- fixture

    private async Task<Role> AddRoleAsync(string name, bool isAdministrator = false)
    {
        var role = new Role { Id = Guid.NewGuid(), Name = name, IsAdministrator = isAdministrator };
        harness.Db.Roles.Add(role);
        await harness.Db.SaveChangesAsync();
        return role;
    }

    private async Task AddUserAsync(
        string name, string? phone = null, Role? role = null,
        UserStatus status = UserStatus.Active, DateTimeOffset? lastLogin = null)
    {
        harness.Db.Users.Add(new User
        {
            Id = Guid.NewGuid(),
            Name = name,
            Email = $"{name.ToLowerInvariant().Replace(' ', '.')}.{Guid.NewGuid():N}@example.com",
            PhoneNumber = phone,
            RoleId = role?.Id,
            Status = status,
            LastLoginAt = lastLogin,
        });
        await harness.Db.SaveChangesAsync();
    }

    private async Task SeedManyAsync(int count, string name)
    {
        for (var i = 0; i < count; i++)
        {
            harness.Db.Users.Add(new User
            {
                Id = Guid.NewGuid(),
                Name = name,
                Email = $"bulk{i}.{Guid.NewGuid():N}@example.com",
                Status = UserStatus.Active,
            });
        }
        await harness.Db.SaveChangesAsync();
    }
}
