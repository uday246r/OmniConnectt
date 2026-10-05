using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Locking;
using AuthService.Infrastructure.Security;
using AuthService.Options;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using MsOptions = Microsoft.Extensions.Options.Options;

namespace AuthService.Tests;

/// <summary>
/// The sweep can email the wrong people, or the same person repeatedly, so its decisions are the thing to
/// pin: one email per threshold per password, no catch-up for thresholds already passed, nothing sent to
/// people a warning cannot help (SSO accounts, unaccepted invites, already-blocked accounts), and a failed
/// send is retried rather than recorded as done. The clock is passed in, so none of this waits on time.
/// </summary>
public class PasswordExpiryReminderSweeperTests : IDisposable
{
    private static readonly DateTimeOffset Now = new(2026, 9, 29, 12, 0, 0, TimeSpan.Zero);

    private readonly AuthDbContext db;
    private readonly PasswordPolicyAppService policy;
    private readonly ApprovalHarness.RecordingEmailSender mail = new();
    private readonly PasswordExpiryReminderSweeper sweeper;

    public PasswordExpiryReminderSweeperTests()
    {
        db = new AuthDbContext(new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"pw-reminders-{Guid.NewGuid()}").Options);
        var audit = TestAudit.For(db);
        policy = new PasswordPolicyAppService(db, audit, MsOptions.Create(new PasswordPolicyOptions()));
        sweeper = new PasswordExpiryReminderSweeper(
            db, policy, mail,
            MsOptions.Create(new SmtpOptions { AppBaseUrl = "https://app.example.com" }),
            MsOptions.Create(new PasswordExpiryReminderOptions { BatchSize = 2 }),
            audit, NullLogger<PasswordExpiryReminderSweeper>.Instance);
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    private async Task<User> AddUserAsync(int daysLeft, Action<User>? tweak = null)
    {
        // 90-day policy: a password changed (90 - daysLeft) days ago has `daysLeft` days remaining.
        var changed = Now.AddDays(-(90 - daysLeft));
        var user = new User
        {
            Id = Guid.NewGuid(), Name = "Jane Doe", Email = $"jane-{Guid.NewGuid():N}@example.com",
            AuthProvider = AuthProvider.Local, Status = UserStatus.Active, PasswordHash = "hash",
            PasswordChangedAt = changed, CreatedAt = changed.AddDays(-1), UpdatedAt = changed,
        };
        tweak?.Invoke(user);
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    private Task SaveNotificationsAsync(bool email = true, bool inApp = true, int[]? lead = null) =>
        policy.UpdateAsync(new UpdatePasswordPolicyRequest(new PasswordPolicyDefinitionDto(
            90, [], new PasswordComplexityDto(), new PasswordExpiryNotificationDto(email, inApp, lead ?? [14, 7, 3, 1]))), null);

    private async Task<int?> SentDayAsync(User u) =>
        (await db.Users.AsNoTracking().SingleAsync(x => x.Id == u.Id)).PasswordExpiryReminderSentDay;

    // ---------------------------------------------------------------- who is warned, and when

    [Fact]
    public async Task Someone_outside_the_widest_window_is_not_emailed()
    {
        await AddUserAsync(daysLeft: 30);

        Assert.Equal(0, await sweeper.RunAsync(Now));
        Assert.Empty(mail.Sent);
    }

    [Fact]
    public async Task Crossing_a_threshold_sends_one_email_naming_the_days_left_and_the_change_link()
    {
        var user = await AddUserAsync(daysLeft: 14);

        Assert.Equal(1, await sweeper.RunAsync(Now));

        var sent = Assert.Single(mail.Sent);
        Assert.Equal(user.Email, sent.To);
        Assert.Contains("14 days", sent.Subject);
        Assert.Contains("https://app.example.com/profile", sent.Text);
        Assert.Equal(14, await SentDayAsync(user));
    }

    [Fact]
    public async Task Running_again_at_the_same_threshold_does_not_email_the_same_person_twice()
    {
        await AddUserAsync(daysLeft: 14);

        await sweeper.RunAsync(Now);
        await sweeper.RunAsync(Now.AddHours(6));
        await sweeper.RunAsync(Now.AddHours(12));

        Assert.Single(mail.Sent);
    }

    [Fact]
    public async Task Each_new_threshold_sends_exactly_one_more_email_as_the_days_tick_down()
    {
        var user = await AddUserAsync(daysLeft: 14);

        await sweeper.RunAsync(Now);                 // 14
        await sweeper.RunAsync(Now.AddDays(7));      // 7 left
        await sweeper.RunAsync(Now.AddDays(11));     // 3 left
        await sweeper.RunAsync(Now.AddDays(11).AddHours(1));

        Assert.Equal(3, mail.Sent.Count);
        Assert.Equal(3, await SentDayAsync(user));
    }

    [Fact]
    public async Task Someone_first_seen_deep_inside_the_window_gets_one_email_not_one_per_threshold_already_passed()
    {
        var user = await AddUserAsync(daysLeft: 2);

        await sweeper.RunAsync(Now);

        Assert.Single(mail.Sent);
        Assert.Equal(3, await SentDayAsync(user)); // the smallest threshold reached: 2 days left is inside "3"
    }

    [Fact]
    public async Task Changing_the_password_restarts_the_sequence_for_the_next_rotation()
    {
        var user = await AddUserAsync(daysLeft: 3, u => u.PasswordExpiryReminderSentDay = 3);

        Assert.Equal(0, await sweeper.RunAsync(Now)); // already warned at 3

        var tracked = await db.Users.SingleAsync(u => u.Id == user.Id);
        tracked.PasswordChangedAt = Now.AddDays(-76); // a new password, 14 days from expiring next time round
        tracked.PasswordExpiryReminderSentDay = null;  // what every password-change path does
        await db.SaveChangesAsync();

        Assert.Equal(1, await sweeper.RunAsync(Now));
    }

    // ---------------------------------------------------------------- who is never emailed

    [Fact]
    public async Task An_already_expired_password_is_not_emailed_because_a_warning_can_no_longer_help()
    {
        await AddUserAsync(daysLeft: -5);

        Assert.Equal(0, await sweeper.RunAsync(Now));
    }

    [Fact]
    public async Task Accounts_a_warning_cannot_help_are_skipped()
    {
        await AddUserAsync(3, u => { u.AuthProvider = AuthProvider.Google; u.PasswordHash = null; });   // SSO: no password
        await AddUserAsync(3, u => u.PasswordHash = null);                                              // invite not accepted
        await AddUserAsync(3, u => u.Status = UserStatus.Inactive);
        await AddUserAsync(3, u => u.MustChangePassword = true);                                        // already blocked

        Assert.Equal(0, await sweeper.RunAsync(Now));
    }

    [Fact]
    public async Task A_deleted_account_is_never_emailed()
    {
        await AddUserAsync(3, u => u.IsDeleted = true);

        Assert.Equal(0, await sweeper.RunAsync(Now));
    }

    // ---------------------------------------------------------------- what the administrator controls

    [Fact]
    public async Task With_the_email_channel_off_nothing_is_sent_though_the_in_app_banner_still_can_be()
    {
        await SaveNotificationsAsync(email: false, inApp: true);
        await AddUserAsync(daysLeft: 3);

        Assert.Equal(0, await sweeper.RunAsync(Now));
    }

    [Fact]
    public async Task With_no_reminder_days_configured_nothing_is_sent()
    {
        await SaveNotificationsAsync(lead: []);
        await AddUserAsync(daysLeft: 1);

        Assert.Equal(0, await sweeper.RunAsync(Now));
    }

    [Fact]
    public async Task The_administrators_own_reminder_days_are_used_not_the_defaults()
    {
        await SaveNotificationsAsync(lead: [10]);
        await AddUserAsync(daysLeft: 12); // inside the default 14 but outside the configured 10
        var inside = await AddUserAsync(daysLeft: 10);

        Assert.Equal(1, await sweeper.RunAsync(Now));
        Assert.Equal(inside.Email, Assert.Single(mail.Sent).To);
    }

    [Fact]
    public async Task A_role_with_a_shorter_lifetime_is_warned_on_its_own_schedule()
    {
        var role = new Role { Id = Guid.NewGuid(), Name = "Treasury", CreatedAt = Now, UpdatedAt = Now };
        db.Roles.Add(role);
        await db.SaveChangesAsync();
        await policy.UpdateAsync(new UpdatePasswordPolicyRequest(new PasswordPolicyDefinitionDto(
            90, [new RolePasswordExpiryDto(role.Id, 30)], new PasswordComplexityDto(),
            new PasswordExpiryNotificationDto(true, true, [14, 7, 3, 1]))), null);

        // 25 days old: fine on the 90-day global, but 5 days from expiry under the 30-day role rule.
        var treasury = await AddUserAsync(daysLeft: 65, u => { u.RoleId = role.Id; u.PasswordChangedAt = Now.AddDays(-25); });
        await AddUserAsync(daysLeft: 65);

        Assert.Equal(1, await sweeper.RunAsync(Now));
        Assert.Equal(treasury.Email, Assert.Single(mail.Sent).To);
    }

    // ---------------------------------------------------------------- delivery

    [Fact]
    public async Task A_failed_send_is_not_recorded_as_done_so_the_next_sweep_retries_it()
    {
        var user = await AddUserAsync(daysLeft: 3);
        mail.IsEnabled = true;
        var failing = new FailingSender();
        var flaky = new PasswordExpiryReminderSweeper(
            db, policy, failing, MsOptions.Create(new SmtpOptions { AppBaseUrl = "https://app.example.com" }),
            MsOptions.Create(new PasswordExpiryReminderOptions()), TestAudit.For(db), NullLogger<PasswordExpiryReminderSweeper>.Instance);

        Assert.Equal(0, await flaky.RunAsync(Now));
        Assert.Null(await SentDayAsync(user));

        Assert.Equal(1, await sweeper.RunAsync(Now)); // mail comes back
    }

    [Fact]
    public async Task Without_a_configured_mail_provider_it_quietly_does_nothing_and_records_nothing()
    {
        mail.IsEnabled = false;
        var user = await AddUserAsync(daysLeft: 3);

        Assert.Equal(0, await sweeper.RunAsync(Now));
        Assert.Null(await SentDayAsync(user));
    }

    [Fact]
    public async Task Every_reminder_leaves_an_audit_row()
    {
        await AddUserAsync(daysLeft: 3);

        await sweeper.RunAsync(Now);

        var row = await db.AuditLogs.SingleAsync(a => a.Action == "auth.password_expiry_reminder_sent");
        Assert.Contains("3-day threshold", row.Details);
    }

    [Fact]
    public async Task A_directory_larger_than_one_batch_is_covered_in_full()
    {
        for (var i = 0; i < 5; i++) await AddUserAsync(daysLeft: 3); // batch size in this fixture is 2

        Assert.Equal(5, await sweeper.RunAsync(Now));
    }

    private sealed class FailingSender : AuthService.Infrastructure.Email.IEmailSender
    {
        public bool IsEnabled => true;
        public Task<bool> SendAsync(string toAddress, string toName, string subject, string htmlBody, string textBody, CancellationToken ct = default)
            => Task.FromResult(false);
    }
}

/// <summary>
/// The scheduling half: the sweep must run under the distributed lock, because emailing every user once
/// per replica is not a harmless duplicate the way a repeated cleanup is.
/// </summary>
public class PasswordExpiryReminderServiceTests
{
    private sealed class HeldLock : IDistributedLock
    {
        public int Attempts;
        public Task<IAsyncDisposable?> TryAcquireAsync(string key, TimeSpan ttl, CancellationToken ct = default)
        {
            Attempts++;
            return Task.FromResult<IAsyncDisposable?>(null); // someone else holds it
        }
    }

    [Fact]
    public async Task A_replica_that_cannot_take_the_lock_skips_the_round_without_touching_the_database()
    {
        var locks = new HeldLock();
        // No services registered: if the sweep tried to resolve the sweeper, GetRequiredService would throw.
        var service = new PasswordExpiryReminderService(
            new ServiceCollection().BuildServiceProvider(), locks,
            MsOptions.Create(new PasswordExpiryReminderOptions { StartupDelay = TimeSpan.Zero, Interval = TimeSpan.FromMinutes(5) }),
            NullLogger<PasswordExpiryReminderService>.Instance);

        using var cts = new CancellationTokenSource();
        await service.StartAsync(cts.Token);
        await Task.Delay(300);
        await cts.CancelAsync();
        await service.StopAsync(CancellationToken.None);

        Assert.True(locks.Attempts >= 1);
    }

    [Fact]
    public async Task The_in_process_lock_lets_only_one_holder_in_at_a_time()
    {
        var locks = new InProcessLock();

        await using var first = await locks.TryAcquireAsync(PasswordExpiryReminderService.LockKey, TimeSpan.FromMinutes(1));
        var second = await locks.TryAcquireAsync(PasswordExpiryReminderService.LockKey, TimeSpan.FromMinutes(1));

        Assert.NotNull(first);
        Assert.Null(second);
    }

    [Fact]
    public async Task A_disabled_service_returns_immediately()
    {
        var service = new PasswordExpiryReminderService(
            new ServiceCollection().BuildServiceProvider(), new HeldLock(),
            MsOptions.Create(new PasswordExpiryReminderOptions { Enabled = false }),
            NullLogger<PasswordExpiryReminderService>.Instance);

        await service.StartAsync(CancellationToken.None);
        await service.StopAsync(CancellationToken.None);
    }
}
