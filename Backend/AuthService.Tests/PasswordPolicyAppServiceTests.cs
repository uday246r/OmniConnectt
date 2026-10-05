using AuthService.Application.DTOs;
using AuthService.Application.Exceptions;
using AuthService.Application.Services;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using AuthService.Options;
using Microsoft.EntityFrameworkCore;
using Xunit;
using MsOptions = Microsoft.Extensions.Options.Options;

namespace AuthService.Tests;

/// <summary>
/// The password policy decides how long every credential on the platform lives and what a new one must
/// look like, so the parts worth pinning are the ones an auditor would probe: a role's own lifetime
/// wins outright, an SSO account or an un-accepted invite can never be "expired", the clock starts from
/// the right moment, and the guards refuse settings that would silently disable rotation (a stray 0
/// on a role) or send a reminder that could never arrive.
/// </summary>
public class PasswordPolicyAppServiceTests : IDisposable
{
    private readonly AuthDbContext db;
    private readonly PasswordPolicyAppService service;

    public PasswordPolicyAppServiceTests() : this(new PasswordPolicyOptions()) { }

    protected PasswordPolicyAppServiceTests(PasswordPolicyOptions seed)
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"password-policy-{Guid.NewGuid()}")
            .Options;

        db = new AuthDbContext(options);
        service = new PasswordPolicyAppService(db, TestAudit.For(db), MsOptions.Create(seed));
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    private static readonly DateTimeOffset Now = new(2026, 9, 29, 12, 0, 0, TimeSpan.Zero);

    private PasswordPolicyDefinitionDto Policy(
        int expiryDays = 90,
        IReadOnlyList<RolePasswordExpiryDto>? roles = null,
        int[]? leadDays = null,
        PasswordComplexityDto? complexity = null) =>
        new(expiryDays, roles ?? [], complexity ?? new PasswordComplexityDto(),
            new PasswordExpiryNotificationDto(true, true, leadDays ?? [14, 7, 3, 1]));

    private static User LocalUser(DateTimeOffset? passwordChangedAt, DateTimeOffset createdAt, Guid? roleId = null) => new()
    {
        Id = Guid.NewGuid(),
        Name = "Jane",
        Email = "jane@example.com",
        AuthProvider = AuthProvider.Local,
        Status = UserStatus.Active,
        PasswordHash = "hash",
        PasswordChangedAt = passwordChangedAt,
        CreatedAt = createdAt,
        UpdatedAt = createdAt,
        RoleId = roleId,
    };

    // ---------------------------------------------------------------- defaults & persistence

    [Fact]
    public async Task GetAsync_before_anyone_has_saved_returns_the_90_day_default_at_version_0()
    {
        var result = await service.GetAsync();

        Assert.Equal(0, result.Version);
        Assert.Equal(90, result.Policy.ExpiryDays);
        Assert.Empty(result.Policy.RoleExpiries);
        Assert.True(result.Policy.Notifications.Email);
        Assert.True(result.Policy.Notifications.InApp);
        Assert.Equal([14, 7, 3, 1], result.Policy.Notifications.LeadDays);
    }

    [Fact]
    public async Task The_default_complexity_comes_from_appsettings_so_a_deployment_that_tightened_them_keeps_enforcing_them()
    {
        using var seeded = new PasswordPolicyAppServiceTests(new PasswordPolicyOptions { MinimumLength = 16, RequireNonAlphanumeric = false });

        var complexity = await seeded.service.GetComplexityAsync();

        Assert.Equal(16, complexity.MinimumLength);
        Assert.False(complexity.RequireNonAlphanumeric);
    }

    [Fact]
    public async Task UpdateAsync_creates_the_row_at_version_1_then_increments()
    {
        var first = await service.UpdateAsync(new UpdatePasswordPolicyRequest(Policy(60)), null);
        var second = await service.UpdateAsync(new UpdatePasswordPolicyRequest(Policy(45)), null);

        Assert.Equal(1, first.Version);
        Assert.Equal(2, second.Version);
        Assert.Equal(45, (await service.GetPolicyAsync()).ExpiryDays);
    }

    [Fact]
    public async Task Once_saved_the_database_is_the_authority_and_appsettings_no_longer_apply()
    {
        using var seeded = new PasswordPolicyAppServiceTests(new PasswordPolicyOptions { MinimumLength = 16 });
        await seeded.service.UpdateAsync(new UpdatePasswordPolicyRequest(
            seeded.Policy(complexity: new PasswordComplexityDto(MinimumLength: 8))), null);

        Assert.Equal(8, (await seeded.service.GetComplexityAsync()).MinimumLength);
    }

    [Fact]
    public async Task UpdateAsync_with_a_stale_expected_version_is_refused_as_a_conflict()
    {
        await service.UpdateAsync(new UpdatePasswordPolicyRequest(Policy(60)), null);

        await Assert.ThrowsAsync<ConflictAppException>(() =>
            service.UpdateAsync(new UpdatePasswordPolicyRequest(Policy(30), ExpectedVersion: 0), null));
    }

    [Fact]
    public async Task UpdateAsync_writes_an_audit_row_naming_the_values_not_just_that_something_changed()
    {
        await service.UpdateAsync(new UpdatePasswordPolicyRequest(Policy(30)), null);

        var row = await db.AuditLogs.SingleAsync(a => a.Action == "password_policy.updated");
        Assert.Contains("30 days", row.Details);
        Assert.Contains("min length 12", row.Details);
    }

    [Fact]
    public async Task A_corrupt_stored_row_falls_back_to_the_default_rather_than_making_sign_in_impossible()
    {
        db.PasswordPolicyCatalogs.Add(new PasswordPolicyCatalog
        {
            Id = Guid.NewGuid(), PolicyJson = "{not json", Version = 3, UpdatedAt = Now,
        });
        await db.SaveChangesAsync();

        Assert.Equal(90, (await service.GetPolicyAsync()).ExpiryDays);
    }

    [Fact]
    public async Task GetAsync_lists_every_role_with_its_active_user_count_but_the_sign_in_read_does_not()
    {
        var treasury = await AddRoleAsync();
        db.Users.Add(LocalUser(null, Now, treasury));
        db.Users.Add(LocalUser(null, Now, treasury));
        var deleted = LocalUser(null, Now, treasury);
        deleted.IsDeleted = true;
        db.Users.Add(deleted);
        await db.SaveChangesAsync();

        var page = await service.GetAsync();

        var role = Assert.Single(page.Roles!);
        Assert.Equal(2, role.UserCount); // a deleted account is not "affected" by a role rule
    }

    [Fact]
    public async Task Reminder_days_are_stored_distinct_and_largest_first_whatever_order_they_arrive_in()
    {
        var saved = await service.UpdateAsync(new UpdatePasswordPolicyRequest(Policy(leadDays: [3, 14, 3, 7])), null);

        Assert.Equal([14, 7, 3], saved.Policy.Notifications.LeadDays);
    }

    // ---------------------------------------------------------------- guards

    [Theory]
    [InlineData(-1)]
    [InlineData(3651)]
    public async Task A_global_expiry_outside_0_to_3650_is_refused(int days)
    {
        await Assert.ThrowsAsync<ValidationAppException>(() =>
            service.UpdateAsync(new UpdatePasswordPolicyRequest(Policy(days, leadDays: [])), null));
    }

    [Fact]
    public async Task A_global_expiry_of_zero_means_never_and_is_accepted()
    {
        var saved = await service.UpdateAsync(new UpdatePasswordPolicyRequest(Policy(0, leadDays: [])), null);

        Assert.Equal(0, saved.Policy.ExpiryDays);
    }

    [Fact]
    public async Task A_role_expiry_of_zero_is_refused_because_inherit_is_the_absence_of_a_row_not_a_zero()
    {
        var role = await AddRoleAsync();

        var ex = await Assert.ThrowsAsync<ValidationAppException>(() => service.UpdateAsync(
            new UpdatePasswordPolicyRequest(Policy(roles: [new RolePasswordExpiryDto(role, 0)])), null));

        Assert.Contains("between 1 and", ex.Message);
    }

    [Fact]
    public async Task A_role_expiry_for_a_role_that_does_not_exist_is_refused()
    {
        var ex = await Assert.ThrowsAsync<ValidationAppException>(() => service.UpdateAsync(
            new UpdatePasswordPolicyRequest(Policy(roles: [new RolePasswordExpiryDto(Guid.NewGuid(), 30)])), null));

        Assert.Contains("no longer exists", ex.Message);
    }

    [Fact]
    public async Task Two_entries_for_the_same_role_collapse_to_the_first()
    {
        var role = await AddRoleAsync();

        var saved = await service.UpdateAsync(new UpdatePasswordPolicyRequest(
            Policy(roles: [new RolePasswordExpiryDto(role, 30), new RolePasswordExpiryDto(role, 60)])), null);

        Assert.Equal(30, Assert.Single(saved.Policy.RoleExpiries).ExpiryDays);
    }

    [Theory]
    [InlineData(5, 128)]   // below the 6-character floor
    [InlineData(65, 128)]  // above the 64-character ceiling
    [InlineData(20, 12)]   // maximum below minimum
    [InlineData(12, 257)]  // maximum above 256
    public async Task Impossible_length_bounds_are_refused(int min, int max)
    {
        await Assert.ThrowsAsync<ValidationAppException>(() => service.UpdateAsync(
            new UpdatePasswordPolicyRequest(Policy(complexity: new PasswordComplexityDto(MinimumLength: min, MaximumLength: max))), null));
    }

    [Fact]
    public async Task More_than_five_reminder_days_are_refused()
    {
        await Assert.ThrowsAsync<ValidationAppException>(() => service.UpdateAsync(
            new UpdatePasswordPolicyRequest(Policy(expiryDays: 365, leadDays: [30, 21, 14, 7, 3, 1])), null));
    }

    [Fact]
    public async Task A_reminder_at_or_after_the_expiry_day_is_refused_because_it_could_never_be_sent()
    {
        var ex = await Assert.ThrowsAsync<ValidationAppException>(() => service.UpdateAsync(
            new UpdatePasswordPolicyRequest(Policy(expiryDays: 30, leadDays: [30])), null));

        Assert.Contains("sooner than the expiry", ex.Message);
    }

    [Fact]
    public async Task A_zero_or_negative_reminder_day_is_refused()
    {
        await Assert.ThrowsAsync<ValidationAppException>(() => service.UpdateAsync(
            new UpdatePasswordPolicyRequest(Policy(leadDays: [0])), null));
    }

    private async Task<Guid> AddRoleAsync()
    {
        var role = new Role { Id = Guid.NewGuid(), Name = $"Role-{Guid.NewGuid():N}", CreatedAt = Now, UpdatedAt = Now };
        db.Roles.Add(role);
        await db.SaveChangesAsync();
        return role.Id;
    }

    // ---------------------------------------------------------------- expiry resolution

    [Fact]
    public void A_role_with_its_own_lifetime_uses_it_instead_of_the_global_one()
    {
        var roleId = Guid.NewGuid();
        var policy = Policy(90, [new RolePasswordExpiryDto(roleId, 30)]);

        Assert.Equal(30, PasswordPolicyAppService.ResolveExpiryDays(LocalUser(null, Now, roleId), policy));
    }

    [Fact]
    public void A_role_override_may_be_LONGER_than_the_global_value_it_is_not_clamped_to_it()
    {
        var roleId = Guid.NewGuid();
        var policy = Policy(90, [new RolePasswordExpiryDto(roleId, 365)]);

        Assert.Equal(365, PasswordPolicyAppService.ResolveExpiryDays(LocalUser(null, Now, roleId), policy));
    }

    [Fact]
    public void A_user_whose_role_has_no_entry_inherits_the_global_lifetime()
    {
        var policy = Policy(90, [new RolePasswordExpiryDto(Guid.NewGuid(), 30)]);

        Assert.Equal(90, PasswordPolicyAppService.ResolveExpiryDays(LocalUser(null, Now, Guid.NewGuid()), policy));
        Assert.Equal(90, PasswordPolicyAppService.ResolveExpiryDays(LocalUser(null, Now, null), policy));
    }

    // ---------------------------------------------------------------- evaluation

    [Fact]
    public void A_password_is_valid_until_the_instant_it_expires_and_expired_from_then_on()
    {
        var user = LocalUser(Now.AddDays(-90).AddMinutes(1), Now.AddYears(-3));
        var policy = Policy(90);

        Assert.False(PasswordPolicyAppService.Evaluate(user, policy, Now).IsExpired);
        Assert.True(PasswordPolicyAppService.Evaluate(user, policy, Now.AddMinutes(1)).IsExpired);
    }

    [Fact]
    public void The_clock_starts_from_the_account_creation_date_when_no_password_change_was_ever_recorded()
    {
        var user = LocalUser(null, Now.AddDays(-100));

        var status = PasswordPolicyAppService.Evaluate(user, Policy(90), Now);

        Assert.True(status.IsExpired);
        Assert.Null(status.PasswordChangedAt);
        Assert.Equal(Now.AddDays(-100).AddDays(90), status.ExpiresAt);
    }

    [Fact]
    public void A_recorded_password_change_wins_over_the_creation_date()
    {
        var user = LocalUser(Now.AddDays(-10), Now.AddDays(-400));

        Assert.False(PasswordPolicyAppService.Evaluate(user, Policy(90), Now).IsExpired);
    }

    [Fact]
    public void Global_expiry_zero_means_nothing_ever_expires()
    {
        var status = PasswordPolicyAppService.Evaluate(LocalUser(Now.AddYears(-20), Now.AddYears(-20)), Policy(0, leadDays: []), Now);

        Assert.False(status.IsExpired);
        Assert.Null(status.ExpiresAt);
        Assert.Null(status.DaysRemaining);
    }

    [Fact]
    public void A_google_account_never_expires_because_it_has_no_OmniConnect_password_to_rotate()
    {
        var user = LocalUser(null, Now.AddYears(-5));
        user.AuthProvider = AuthProvider.Google;
        user.PasswordHash = null;

        Assert.False(PasswordPolicyAppService.Evaluate(user, Policy(90), Now).IsExpired);
    }

    [Fact]
    public void An_invite_that_has_not_been_accepted_yet_cannot_be_expired_because_there_is_no_password()
    {
        var user = LocalUser(null, Now.AddDays(-400));
        user.PasswordHash = null;

        var status = PasswordPolicyAppService.Evaluate(user, Policy(90), Now);

        Assert.False(status.IsExpired);
        Assert.Null(status.ExpiresAt);
    }

    [Fact]
    public void Days_remaining_rounds_up_so_a_still_valid_password_never_reads_as_zero_days()
    {
        var user = LocalUser(Now.AddDays(-90).AddHours(3), Now.AddYears(-1));

        var status = PasswordPolicyAppService.Evaluate(user, Policy(90), Now);

        Assert.Equal(1, status.DaysRemaining);
        Assert.False(status.IsExpired);
    }

    [Fact]
    public void An_expired_password_reports_zero_days_remaining()
    {
        var status = PasswordPolicyAppService.Evaluate(LocalUser(Now.AddDays(-120), Now.AddYears(-1)), Policy(90), Now);

        Assert.Equal(0, status.DaysRemaining);
    }

    [Theory]
    [InlineData(20, false)]  // 20 days left, widest reminder is 14
    [InlineData(14, true)]   // exactly on the widest threshold
    [InlineData(5, true)]
    [InlineData(0, false)]   // expired is not "in the warning window" — it is past it
    public void The_warning_window_opens_at_the_widest_reminder_day_and_closes_at_expiry(int daysLeft, bool expected)
    {
        var user = LocalUser(Now.AddDays(-90 + daysLeft).AddHours(-1), Now.AddYears(-1));
        var policy = Policy(90);

        var status = PasswordPolicyAppService.Evaluate(user, policy, daysLeft == 0 ? Now.AddDays(2) : Now);

        Assert.Equal(expected, status.IsInWarningWindow);
    }

    [Fact]
    public void With_no_reminder_days_configured_the_warning_window_never_opens()
    {
        var user = LocalUser(Now.AddDays(-89), Now.AddYears(-1));

        Assert.False(PasswordPolicyAppService.Evaluate(user, Policy(90, leadDays: []), Now).IsInWarningWindow);
    }

    [Fact]
    public void A_shorter_role_lifetime_pulls_that_role_into_its_warning_window_while_others_are_unaffected()
    {
        var roleId = Guid.NewGuid();
        var policy = Policy(90, [new RolePasswordExpiryDto(roleId, 30)]);
        var changed = Now.AddDays(-25);

        Assert.True(PasswordPolicyAppService.Evaluate(LocalUser(changed, Now.AddYears(-1), roleId), policy, Now).IsInWarningWindow);
        Assert.False(PasswordPolicyAppService.Evaluate(LocalUser(changed, Now.AddYears(-1), null), policy, Now).IsInWarningWindow);
    }

    // ---------------------------------------------------------------- complexity (moved off PasswordPolicyOptions)

    [Theory]
    [InlineData("Sh0rt!", false)]                // under 12 characters
    [InlineData("alllowercase1!x", false)]       // no uppercase
    [InlineData("ALLUPPERCASE1!X", false)]       // no lowercase
    [InlineData("NoDigitsHere!!Ab", false)]      // no digit
    [InlineData("NoSymbolsHere12Ab", false)]     // no symbol
    [InlineData("   ", false)]                   // whitespace only
    [InlineData("Str0ng&Long-enough", true)]
    public void Validate_enforces_every_enabled_rule(string password, bool acceptable)
    {
        var complexity = new PasswordComplexityDto();

        Assert.Equal(acceptable, complexity.Validate(password) is null);
    }

    [Fact]
    public void Validate_stops_enforcing_a_rule_that_has_been_switched_off()
    {
        var relaxed = new PasswordComplexityDto(MinimumLength: 8, RequireNonAlphanumeric: false);

        Assert.Null(relaxed.Validate("Abcdefg1"));
    }

    [Fact]
    public void Validate_rejects_a_password_over_the_maximum_length()
    {
        var complexity = new PasswordComplexityDto(MinimumLength: 8, MaximumLength: 20);

        Assert.NotNull(complexity.Validate("Aa1!" + new string('x', 30)));
    }

    [Fact]
    public void Describe_is_built_from_the_values_so_it_cannot_disagree_with_what_Validate_checks()
    {
        var text = new PasswordComplexityDto(MinimumLength: 10, RequireDigit: false, RequireNonAlphanumeric: false).Describe();

        Assert.Contains("at least 10 characters", text);
        Assert.Contains("uppercase", text);
        Assert.DoesNotContain("digit", text);
        Assert.DoesNotContain("symbol", text);
    }
    // ---------------------------------------------------------------- role link storage

    /*
     * A role's override used to sit inside the policy JSON, where nothing in the database could see the
     * link to Roles. These pin the table that replaced it: the link is a row keyed by the role, and the
     * JSON no longer carries the overrides at all.
     */

    [Fact]
    public async Task A_role_override_is_stored_as_a_row_keyed_by_the_role_not_inside_the_policy_json()
    {
        var treasury = await AddRoleAsync();

        await service.UpdateAsync(new UpdatePasswordPolicyRequest(Policy(roles: [new(treasury, 30)])), null);

        var row = await db.PasswordPolicyRoleExpiries.AsNoTracking().SingleAsync();
        Assert.Equal(treasury, row.RoleId);
        Assert.Equal(30, row.ExpiryDays);

        var json = (await db.PasswordPolicyCatalogs.AsNoTracking().SingleAsync()).PolicyJson;
        // The key stays for the shape of the document, but it carries nothing.
        Assert.Contains("\"roleExpiries\":[]", json);
        Assert.DoesNotContain(treasury.ToString(), json);
    }

    [Fact]
    public async Task Saving_replaces_the_role_rows_rather_than_adding_to_them()
    {
        var treasury = await AddRoleAsync();
        var analyst = await AddRoleAsync();
        await service.UpdateAsync(new UpdatePasswordPolicyRequest(Policy(roles: [new(treasury, 30)])), null);

        await service.UpdateAsync(new UpdatePasswordPolicyRequest(Policy(roles: [new(analyst, 45)])), null);

        var rows = await db.PasswordPolicyRoleExpiries.AsNoTracking().ToListAsync();
        Assert.Single(rows);
        Assert.Equal(analyst, rows[0].RoleId);
    }

    [Fact]
    public async Task Reading_the_policy_returns_the_role_rows_so_the_expiry_check_still_sees_them()
    {
        var treasury = await AddRoleAsync();
        await service.UpdateAsync(new UpdatePasswordPolicyRequest(Policy(roles: [new(treasury, 30)])), null);

        var policy = await service.GetPolicyAsync();

        Assert.Equal([new RolePasswordExpiryDto(treasury, 30)], policy.RoleExpiries);
    }

    [Fact]
    public async Task Deleting_a_role_removes_its_override_with_it()
    {
        var treasury = await AddRoleAsync();
        await service.UpdateAsync(new UpdatePasswordPolicyRequest(Policy(roles: [new(treasury, 30)])), null);

        db.Roles.Remove(await db.Roles.SingleAsync(r => r.Id == treasury));
        await db.SaveChangesAsync();

        Assert.Empty(await db.PasswordPolicyRoleExpiries.AsNoTracking().ToListAsync());
    }
}
