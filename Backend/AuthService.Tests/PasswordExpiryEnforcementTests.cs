using System.Security.Cryptography;
using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Security;
using AuthService.Options;
using Microsoft.EntityFrameworkCore;
using Xunit;
using MsOptions = Microsoft.Extensions.Options.Options;

namespace AuthService.Tests;

/// <summary>
/// The policy is only worth anything if the sign-in paths actually enforce it. These drive the real
/// <see cref="AuthAppService"/> (login, refresh, change-password) over an in-memory database, with a
/// throwaway RSA key so tokens are genuinely issued — because the property that matters is what the
/// issued token says: an expired account must get a token carrying <c>mustChangePassword</c>, which is
/// what <c>MustChangePasswordFilter</c> then uses to close every other endpoint.
/// </summary>
public class PasswordExpiryEnforcementTests : IDisposable
{
    private const string GoodPassword = "Str0ng&Long-enough";

    private readonly AuthDbContext db;
    private readonly PasswordHasher hasher = new();
    private readonly PasswordPolicyAppService policy;
    private readonly AuthAppService auth;

    public PasswordExpiryEnforcementTests()
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"password-expiry-{Guid.NewGuid()}")
            .Options;
        db = new AuthDbContext(options);

        var audit = TestAudit.For(db);
        var jwt = MsOptions.Create(new JwtOptions { SigningKeyPrivate = RSA.Create(2048).ExportPkcs8PrivateKeyPem() });
        policy = new PasswordPolicyAppService(db, audit, MsOptions.Create(new PasswordPolicyOptions()));

        auth = new AuthAppService(
            db, hasher, new JwtTokenService(jwt), new RefreshTokenService(db, jwt),
            new PermissionClaimsBuilder(db), audit, MsOptions.Create(new GoogleAuthOptions()), policy);
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    private async Task<User> AddUserAsync(int passwordAgeDays, Guid? roleId = null, bool mustChange = false)
    {
        var changed = DateTimeOffset.UtcNow.AddDays(-passwordAgeDays);
        var user = new User
        {
            Id = Guid.NewGuid(),
            Name = "Jane Doe",
            Email = $"jane-{Guid.NewGuid():N}@example.com",
            AuthProvider = AuthProvider.Local,
            Status = UserStatus.Active,
            RoleId = roleId,
            MustChangePassword = mustChange,
            PasswordChangedAt = changed,
            CreatedAt = changed.AddDays(-1),
            UpdatedAt = changed,
        };
        user.PasswordHash = hasher.Hash(user, GoodPassword);
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    private Task<AuthResult> LoginAsync(User user) => auth.LoginAsync(user.Email, GoodPassword, "203.0.113.7", "test");

    // ---------------------------------------------------------------- login

    [Fact]
    public async Task A_password_inside_its_lifetime_signs_in_without_being_flagged()
    {
        var user = await AddUserAsync(passwordAgeDays: 10);

        var result = await LoginAsync(user);

        Assert.False(result.User.MustChangePassword);
        Assert.False((await db.Users.SingleAsync(u => u.Id == user.Id)).MustChangePassword);
    }

    [Fact]
    public async Task An_expired_password_still_signs_in_but_the_account_is_flagged_and_the_returned_user_says_so()
    {
        var user = await AddUserAsync(passwordAgeDays: 120);

        var result = await LoginAsync(user);

        // The session exists — the user has to be able to reach the change-password screen — but it is
        // the restricted kind: the same flag an administrator-issued temporary password uses.
        Assert.True(result.User.MustChangePassword);
        Assert.True((await db.Users.SingleAsync(u => u.Id == user.Id)).MustChangePassword);
    }

    [Fact]
    public async Task The_issued_access_token_carries_mustChangePassword_so_the_server_filter_can_close_the_API()
    {
        var user = await AddUserAsync(passwordAgeDays: 120);

        var result = await LoginAsync(user);

        var token = new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler().ReadJwtToken(result.AccessToken);
        Assert.Equal("true", token.Claims.Single(c => c.Type == JwtTokenService.MustChangePasswordClaimType).Value);
    }

    [Fact]
    public async Task Expiry_is_audited_once_on_the_transition_not_on_every_sign_in_afterwards()
    {
        var user = await AddUserAsync(passwordAgeDays: 120);

        await LoginAsync(user);
        await LoginAsync(user);

        Assert.Equal(1, await db.AuditLogs.CountAsync(a => a.Action == "auth.password_expired"));
    }

    [Fact]
    public async Task A_role_with_a_shorter_lifetime_expires_its_users_while_the_same_age_password_elsewhere_is_fine()
    {
        var role = new Role { Id = Guid.NewGuid(), Name = "Treasury", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow };
        db.Roles.Add(role);
        await db.SaveChangesAsync();
        await policy.UpdateAsync(new UpdatePasswordPolicyRequest(new PasswordPolicyDefinitionDto(
            90, [new RolePasswordExpiryDto(role.Id, 30)], new PasswordComplexityDto(), new PasswordExpiryNotificationDto())), null);

        var treasury = await AddUserAsync(passwordAgeDays: 45, roleId: role.Id);
        var everyoneElse = await AddUserAsync(passwordAgeDays: 45);

        Assert.True((await LoginAsync(treasury)).User.MustChangePassword);
        Assert.False((await LoginAsync(everyoneElse)).User.MustChangePassword);
    }

    [Fact]
    public async Task Switching_expiry_off_globally_stops_flagging_even_a_very_old_password()
    {
        await policy.UpdateAsync(new UpdatePasswordPolicyRequest(new PasswordPolicyDefinitionDto(
            0, [], new PasswordComplexityDto(), new PasswordExpiryNotificationDto(LeadDays: []))), null);
        var user = await AddUserAsync(passwordAgeDays: 4000);

        Assert.False((await LoginAsync(user)).User.MustChangePassword);
    }

    // ---------------------------------------------------------------- refresh (the second door)

    [Fact]
    public async Task A_session_opened_before_expiry_is_flagged_on_its_next_refresh_once_the_password_has_expired()
    {
        // Login is not the only way in: a session lives up to AbsoluteSessionHours and refreshes silently.
        // Without a check here, a password that expired overnight would stay usable until the session ended.
        var user = await AddUserAsync(passwordAgeDays: 10);
        var login = await LoginAsync(user);
        Assert.False(login.User.MustChangePassword);

        (await db.Users.SingleAsync(u => u.Id == user.Id)).PasswordChangedAt = DateTimeOffset.UtcNow.AddDays(-200);
        await db.SaveChangesAsync();

        var refreshed = await auth.RefreshAsync(login.RefreshToken, "203.0.113.7");

        Assert.True(refreshed.User.MustChangePassword);
        var token = new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler().ReadJwtToken(refreshed.AccessToken);
        Assert.Equal("true", token.Claims.Single(c => c.Type == JwtTokenService.MustChangePasswordClaimType).Value);
    }

    [Fact]
    public async Task A_refresh_for_a_still_valid_password_stays_unflagged()
    {
        var user = await AddUserAsync(passwordAgeDays: 10);
        var login = await LoginAsync(user);

        var refreshed = await auth.RefreshAsync(login.RefreshToken, "203.0.113.7");

        Assert.False(refreshed.User.MustChangePassword);
    }

    // ---------------------------------------------------------------- what the client is told

    [Fact]
    public async Task An_expired_user_is_told_the_password_has_expired_so_the_gate_can_say_so_rather_than_use_temporary_password_wording()
    {
        var user = await AddUserAsync(passwordAgeDays: 120);

        var expiry = (await LoginAsync(user)).User.PasswordExpiry!;

        Assert.True(expiry.IsExpired);
        Assert.Equal(0, expiry.DaysRemaining);
        Assert.False(expiry.ShowReminder); // past the warning window, not in it
    }

    [Fact]
    public async Task A_temporary_password_is_not_reported_as_expired_even_though_it_shares_the_must_change_flag()
    {
        var user = await AddUserAsync(passwordAgeDays: 1, mustChange: true);

        var result = (await LoginAsync(user)).User;

        Assert.True(result.MustChangePassword);
        Assert.False(result.PasswordExpiry!.IsExpired);
    }

    [Fact]
    public async Task A_reminder_is_shown_inside_the_warning_window_only_when_the_in_app_channel_is_on()
    {
        var user = await AddUserAsync(passwordAgeDays: 85); // 5 days left, widest reminder is 14

        Assert.True((await auth.GetCurrentUserAsync(user.Id))!.PasswordExpiry!.ShowReminder);

        await policy.UpdateAsync(new UpdatePasswordPolicyRequest(new PasswordPolicyDefinitionDto(
            90, [], new PasswordComplexityDto(), new PasswordExpiryNotificationDto(Email: true, InApp: false, LeadDays: [14, 7, 3, 1]))), null);

        var current = await auth.GetCurrentUserAsync(user.Id);
        Assert.False(current!.PasswordExpiry!.ShowReminder);
        Assert.Equal(5, current.PasswordExpiry.DaysRemaining); // the data is still there; only the banner is off
    }

    [Fact]
    public async Task No_reminder_is_shown_outside_the_warning_window()
    {
        var user = await AddUserAsync(passwordAgeDays: 10);

        var expiry = (await auth.GetCurrentUserAsync(user.Id))!.PasswordExpiry!;

        Assert.False(expiry.ShowReminder);
        Assert.Equal(80, expiry.DaysRemaining);
    }

    [Fact]
    public async Task A_user_whose_password_never_expires_gets_no_dates_and_no_reminder()
    {
        await policy.UpdateAsync(new UpdatePasswordPolicyRequest(new PasswordPolicyDefinitionDto(
            0, [], new PasswordComplexityDto(), new PasswordExpiryNotificationDto(LeadDays: []))), null);
        var user = await AddUserAsync(passwordAgeDays: 500);

        var expiry = (await auth.GetCurrentUserAsync(user.Id))!.PasswordExpiry!;

        Assert.Null(expiry.ExpiresAt);
        Assert.Null(expiry.DaysRemaining);
        Assert.False(expiry.IsExpired);
        Assert.False(expiry.ShowReminder);
    }

    // ---------------------------------------------------------------- changing it

    [Fact]
    public async Task Changing_an_expired_password_lifts_the_flag_restarts_the_clock_and_resets_the_reminder_sequence()
    {
        var user = await AddUserAsync(passwordAgeDays: 120);
        user.PasswordExpiryReminderSentDay = 3;
        await db.SaveChangesAsync();
        await LoginAsync(user);

        await auth.ChangePasswordAsync(user.Id, GoodPassword, "An0ther&Good-one", null, null, null);

        var reloaded = await db.Users.SingleAsync(u => u.Id == user.Id);
        Assert.False(reloaded.MustChangePassword);
        Assert.True(DateTimeOffset.UtcNow - reloaded.PasswordChangedAt < TimeSpan.FromMinutes(1));
        Assert.Null(reloaded.PasswordExpiryReminderSentDay);
        Assert.False(PasswordPolicyAppService.Evaluate(reloaded, await policy.GetPolicyAsync()).IsExpired);
    }

    [Fact]
    public async Task A_new_password_is_judged_against_the_policy_in_the_database_not_the_appsettings_defaults()
    {
        var user = await AddUserAsync(passwordAgeDays: 1);
        const string shortButAcceptableNow = "Abcdefg1";

        // The default (12 characters, a symbol) rejects this...
        await Assert.ThrowsAsync<PasswordChangeRejectedException>(() =>
            auth.ChangePasswordAsync(user.Id, GoodPassword, shortButAcceptableNow, null, null, null));

        // ...until an administrator relaxes the rules on the policy page.
        await policy.UpdateAsync(new UpdatePasswordPolicyRequest(new PasswordPolicyDefinitionDto(
            90, [], new PasswordComplexityDto(MinimumLength: 8, RequireNonAlphanumeric: false), new PasswordExpiryNotificationDto())), null);

        var result = await auth.ChangePasswordAsync(user.Id, GoodPassword, shortButAcceptableNow, null, null, null);

        Assert.Equal("Password updated.", result.Message);
    }

    [Fact]
    public async Task The_new_password_may_not_be_the_current_one()
    {
        var user = await AddUserAsync(passwordAgeDays: 120);

        await Assert.ThrowsAsync<PasswordChangeRejectedException>(() =>
            auth.ChangePasswordAsync(user.Id, GoodPassword, GoodPassword, null, null, null));
    }
}
