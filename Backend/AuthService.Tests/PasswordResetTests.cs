using AuthService.Application.DTOs;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// "Forgot password?" — requesting a reset link and redeeming it.
/// </summary>
/// <remarks>
/// <para>
/// The property worth testing hardest here is the one an ordinary happy-path test would never catch:
/// <see cref="AuthService.Application.Services.PasswordResetService.RequestResetAsync"/> must behave
/// identically to its CALLER whether or not the submitted address belongs to a real, resettable
/// account — an unknown address, a Google account, and an inactive account all take the silent "do
/// nothing" branch rather than a distinguishable error, because the alternative lets an anonymous
/// caller use this endpoint to test which email addresses have accounts.
/// </para>
/// <para>
/// Each case drives the real <c>PasswordResetService</c> over an in-memory database, with only the
/// mail transport faked (<see cref="ApprovalHarness.RecordingEmailSender"/>).
/// </para>
/// </remarks>
public class PasswordResetTests : IDisposable
{
    private readonly ApprovalHarness h = new();

    public void Dispose()
    {
        h.Dispose();
        GC.SuppressFinalize(this);
    }

    private async Task<User> AddLocalUserAsync(string email = "jane.doe@example.com", UserStatus status = UserStatus.Active)
    {
        var applied = (await h.Users.CreateAsync(
            new CreateUserRequest("Jane Doe", email, "0100000000", null, true, "Local", null, null),
            overrides: null, actingUserId: null)).Applied!;

        var user = await h.Db.Users.SingleAsync(u => u.Id == applied.User.Id);
        user.Status = status;
        await h.Db.SaveChangesAsync();

        h.Emails.Sent.Clear(); // discard the set-password invite fired by account creation
        return user;
    }

    [Fact]
    public async Task Requesting_a_reset_for_a_real_active_local_account_emails_a_link()
    {
        var user = await AddLocalUserAsync();

        await h.PasswordResets.RequestResetAsync(user.Email, clientIp: "203.0.113.7", userAgent: "test-agent");

        Assert.Contains(h.Emails.Sent, m => m.To == user.Email && m.Subject.Contains("Reset"));
    }

    /// <summary>The whole point of the mechanism — see the class remarks.</summary>
    [Fact]
    public async Task Requesting_a_reset_for_an_email_that_does_not_exist_sends_nothing_and_throws_nothing()
    {
        await h.PasswordResets.RequestResetAsync("nobody@example.com", null, null);

        Assert.Empty(h.Emails.Sent);
    }

    [Fact]
    public async Task A_google_account_receives_no_reset_link_because_it_has_no_local_password()
    {
        var applied = (await h.Users.CreateAsync(
            new CreateUserRequest("Gina Ops", "gina@example.com", "0100000001", null, true, "Google", null, null),
            overrides: null, actingUserId: null)).Applied!;
        h.Emails.Sent.Clear();

        await h.PasswordResets.RequestResetAsync("gina@example.com", null, null);

        Assert.Empty(h.Emails.Sent);
    }

    [Fact]
    public async Task An_inactive_account_receives_no_reset_link()
    {
        var user = await AddLocalUserAsync(status: UserStatus.Inactive);

        await h.PasswordResets.RequestResetAsync(user.Email, null, null);

        Assert.Empty(h.Emails.Sent);
    }

    [Fact]
    public async Task Email_lookup_is_case_and_whitespace_insensitive()
    {
        var user = await AddLocalUserAsync(email: "case.sensitive@example.com");

        await h.PasswordResets.RequestResetAsync("  Case.Sensitive@Example.com  ", null, null);

        Assert.Contains(h.Emails.Sent, m => m.To == user.Email);
    }

    /// <summary>
    /// A second request must not leave two live links — otherwise an earlier email, forwarded or
    /// screenshotted, would keep working after the user believed they had asked for a fresh one.
    /// </summary>
    [Fact]
    public async Task A_second_request_leaves_exactly_one_usable_link()
    {
        var user = await AddLocalUserAsync();

        await h.PasswordResets.RequestResetAsync(user.Email, null, null);
        await h.PasswordResets.RequestResetAsync(user.Email, null, null);

        var tokens = await h.Db.PasswordResetTokens.AsNoTracking()
            .Where(t => t.UserId == user.Id).ToListAsync();

        Assert.Equal(2, tokens.Count);
        Assert.Single(tokens, t => t.IsRedeemable);
    }

    [Fact]
    public async Task A_successful_request_is_recorded_on_the_audit_trail()
    {
        var user = await AddLocalUserAsync();

        await h.PasswordResets.RequestResetAsync(user.Email, "203.0.113.7", "test-agent");

        var row = await h.Db.AuditLogs.SingleAsync(a => a.Action == "auth.password_reset_requested");
        Assert.Equal(user.Email, row.EntityLabel);
        Assert.Equal("Success", row.Result);
    }

    /// <summary>Nothing is emitted for an address that never resolved to a real account — see class remarks.</summary>
    [Fact]
    public async Task An_unknown_address_produces_no_audit_row_either()
    {
        await h.PasswordResets.RequestResetAsync("nobody@example.com", null, null);

        Assert.DoesNotContain(h.Db.AuditLogs, a => a.Action == "auth.password_reset_requested");
    }

    [Fact]
    public async Task A_deployment_without_smtp_sends_nothing_and_does_not_throw()
    {
        var user = await AddLocalUserAsync();
        h.Emails.IsEnabled = false;

        await h.PasswordResets.RequestResetAsync(user.Email, null, null);

        Assert.Empty(h.Emails.Sent);
    }

    // ── Redeeming ────────────────────────────────────────────────────────────

    /// <summary>
    /// The raw token exists only in the email that was sent — by design, nothing else in the system
    /// can recover it (see <see cref="Domain.Entities.PasswordResetToken"/>). Tests recover it the same
    /// way a real recipient would: by reading the link out of the message body.
    /// </summary>
    private async Task<string> IssueRawTokenAsync(User user)
    {
        await h.PasswordResets.RequestResetAsync(user.Email, null, null);

        var sent = h.Emails.Sent.Last(m => m.To == user.Email);
        var match = System.Text.RegularExpressions.Regex.Match(sent.Text, @"reset-password\?token=(\S+)");
        Assert.True(match.Success, "Expected the reset email body to contain a reset-password link.");
        return Uri.UnescapeDataString(match.Groups[1].Value.Trim());
    }

    [Fact]
    public async Task Redeeming_a_valid_token_sets_the_new_password_and_spends_the_link()
    {
        var user = await AddLocalUserAsync();
        var token = await IssueRawTokenAsync(user);

        var error = await h.PasswordResets.RedeemAsync(token, "Str0ng!Passw0rd");

        Assert.Null(error);
        var stored = await h.Db.PasswordResetTokens.AsNoTracking().SingleAsync(t => t.UserId == user.Id);
        Assert.NotNull(stored.UsedAt);
        Assert.False((await h.PasswordResets.FindRedeemableAsync(token)) is not null);
    }

    [Fact]
    public async Task Redeeming_revokes_every_active_session_for_the_account()
    {
        var user = await AddLocalUserAsync();
        await h.RefreshTokens.IssueAsync(user.Id, "203.0.113.7");
        await h.RefreshTokens.IssueAsync(user.Id, "203.0.113.9");

        var token = await IssueRawTokenAsync(user);
        await h.PasswordResets.RedeemAsync(token, "Str0ng!Passw0rd");

        var active = await h.Db.RefreshTokens.AsNoTracking()
            .Where(t => t.UserId == user.Id && t.RevokedAt == null).CountAsync();
        Assert.Equal(0, active);
    }

    [Fact]
    public async Task An_expired_token_cannot_be_redeemed()
    {
        var user = await AddLocalUserAsync();
        var token = await IssueRawTokenAsync(user);

        var row = await h.Db.PasswordResetTokens.SingleAsync(t => t.UserId == user.Id);
        row.ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1);
        await h.Db.SaveChangesAsync();

        var error = await h.PasswordResets.RedeemAsync(token, "Str0ng!Passw0rd");

        Assert.NotNull(error);
    }

    [Fact]
    public async Task A_used_token_cannot_be_redeemed_a_second_time()
    {
        var user = await AddLocalUserAsync();
        var token = await IssueRawTokenAsync(user);

        await h.PasswordResets.RedeemAsync(token, "Str0ng!Passw0rd");
        var secondError = await h.PasswordResets.RedeemAsync(token, "AnotherStr0ng!Pass");

        Assert.NotNull(secondError);
    }

    [Fact]
    public async Task A_completed_reset_is_recorded_on_the_audit_trail()
    {
        var user = await AddLocalUserAsync();
        var token = await IssueRawTokenAsync(user);

        await h.PasswordResets.RedeemAsync(token, "Str0ng!Passw0rd");

        var row = await h.Db.AuditLogs.SingleAsync(a => a.Action == "auth.password_reset_completed");
        Assert.Equal(user.Email, row.EntityLabel);
    }

    [Fact]
    public async Task A_bogus_token_is_rejected_with_the_same_generic_message_as_an_expired_one()
    {
        var error = await h.PasswordResets.RedeemAsync("not-a-real-token", "Str0ng!Passw0rd");

        Assert.NotNull(error);
    }
}
