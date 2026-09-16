using AuthService.Application.DTOs;
using AuthService.Application.Exceptions;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// Re-issuing a set-password invite.
/// </summary>
/// <remarks>
/// <para>
/// This is the only recovery path a newly provisioned account has. Nothing is stored that can be
/// handed over after the fact — the raw token lives in the sent email and nowhere else — so when the
/// first invite fails to land (SMTP was off, delivery bounced, or the link expired unopened) the
/// account is real, is listed, and cannot be signed into by anyone, forever, unless a fresh link is
/// sent. That makes the refusals as load-bearing as the happy path: an invite handed out for an
/// account that already has a password is not a convenience, it is an account takeover.
/// </para>
/// <para>
/// Each case drives the real <c>SetPasswordInviteService</c> over an in-memory database, with only
/// the mail transport faked (<see cref="ApprovalHarness.RecordingEmailSender"/>).
/// </para>
/// </remarks>
public class SetPasswordInviteResendTests : IDisposable
{
    private readonly ApprovalHarness h = new();

    public void Dispose()
    {
        h.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <summary>
    /// Creates a real, ungated account and backdates its first invite past the resend cooldown, which
    /// is the state an operator is actually in by the time they notice the mail never arrived.
    /// </summary>
    private async Task<User> ProvisionAwaitingSetupAsync(string email = "new.hire@example.com")
    {
        var applied = (await h.Users.CreateAsync(
            new CreateUserRequest("New Hire", email, "0100000000", null, true, "Local", null, null),
            overrides: null, actingUserId: null)).Applied!;

        foreach (var invite in await h.Db.SetPasswordInvites.Where(i => i.UserId == applied.User.Id).ToListAsync())
        {
            invite.CreatedAt = DateTimeOffset.UtcNow.AddHours(-2);
        }
        await h.Db.SaveChangesAsync();
        h.Emails.Sent.Clear();

        return await h.Db.Users.SingleAsync(u => u.Id == applied.User.Id);
    }

    [Fact]
    public async Task A_resend_emails_a_fresh_link_to_the_account_still_waiting_to_set_a_password()
    {
        var user = await ProvisionAwaitingSetupAsync();

        var emailed = await h.Invites.ResendAsync(user.Id, actingUserId: null);

        Assert.True(emailed);
        Assert.Contains(h.Emails.Sent, m => m.To == user.Email);
    }

    /// <summary>
    /// Two live links for one account would mean the older mail still works after the operator
    /// believed they had replaced it — so the previous invite is revoked as part of issuing the new one.
    /// </summary>
    [Fact]
    public async Task Resending_leaves_exactly_one_usable_link()
    {
        var user = await ProvisionAwaitingSetupAsync();

        await h.Invites.ResendAsync(user.Id, actingUserId: null);

        var invites = await h.Db.SetPasswordInvites.AsNoTracking()
            .Where(i => i.UserId == user.Id).ToListAsync();

        Assert.Equal(2, invites.Count);
        Assert.Single(invites, i => i.IsRedeemable);
    }

    [Fact]
    public async Task A_resend_is_recorded_distinctly_from_the_original_invite()
    {
        var user = await ProvisionAwaitingSetupAsync();

        await h.Invites.ResendAsync(user.Id, actingUserId: null);

        var resent = await h.Db.AuditLogs.SingleAsync(a => a.Action == "auth.invite_resent");
        Assert.Equal(user.Email, resent.EntityLabel);
        Assert.Equal("Success", resent.Result);
    }

    /// <summary>
    /// The refusal that matters most. A spent invite means the user chose their own password, so a new
    /// link would hand whoever clicked Resend the ability to replace it — a takeover wearing the
    /// clothes of a helpful admin action. Password reset is the deliberate, separately-audited path.
    /// </summary>
    [Fact]
    public async Task An_account_that_already_set_its_password_is_refused()
    {
        var user = await ProvisionAwaitingSetupAsync();
        var invite = await h.Db.SetPasswordInvites.FirstAsync(i => i.UserId == user.Id);
        invite.UsedAt = DateTimeOffset.UtcNow;
        await h.Db.SaveChangesAsync();

        var error = await Assert.ThrowsAsync<ConflictAppException>(
            () => h.Invites.ResendAsync(user.Id, actingUserId: null));

        Assert.Contains("already set their password", error.Message);
        Assert.Empty(h.Emails.Sent);
    }

    [Fact]
    public async Task A_google_account_is_refused_because_it_has_no_password_to_set()
    {
        var applied = (await h.Users.CreateAsync(
            new CreateUserRequest("Gina Ops", "gina@example.com", "0100000001", null, true, "Google", null, null),
            overrides: null, actingUserId: null)).Applied!;

        var error = await Assert.ThrowsAsync<ConflictAppException>(
            () => h.Invites.ResendAsync(applied.User.Id, actingUserId: null));

        Assert.Contains("Google", error.Message);
    }

    [Fact]
    public async Task A_disabled_account_is_refused_rather_than_invited_back_in()
    {
        var user = await ProvisionAwaitingSetupAsync();
        user.Status = UserStatus.Inactive;
        await h.Db.SaveChangesAsync();

        var error = await Assert.ThrowsAsync<ConflictAppException>(
            () => h.Invites.ResendAsync(user.Id, actingUserId: null));

        Assert.Contains("not active", error.Message);
    }

    /// <summary>
    /// Issuing revokes the previous link, so an impatient second click would invalidate the mail
    /// already on its way — the user would click the link they just received and be told it is dead.
    /// </summary>
    [Fact]
    public async Task A_second_resend_moments_later_is_refused_so_the_mail_in_flight_stays_valid()
    {
        var user = await ProvisionAwaitingSetupAsync();
        await h.Invites.ResendAsync(user.Id, actingUserId: null);

        var error = await Assert.ThrowsAsync<ConflictAppException>(
            () => h.Invites.ResendAsync(user.Id, actingUserId: null));

        Assert.Contains("less than", error.Message);
        Assert.Single(h.Emails.Sent);
    }

    /// <summary>
    /// Refused up front rather than reported as a silent non-delivery: an operator who just set up a
    /// mail server and clicked Resend needs to be told the server still has no mail configured.
    /// </summary>
    [Fact]
    public async Task A_deployment_without_smtp_is_told_so_instead_of_reporting_a_send()
    {
        var user = await ProvisionAwaitingSetupAsync();
        h.Emails.IsEnabled = false;

        var error = await Assert.ThrowsAsync<ConflictAppException>(
            () => h.Invites.ResendAsync(user.Id, actingUserId: null));

        Assert.Contains("Email is not configured", error.Message);
    }

    [Fact]
    public async Task An_unknown_user_is_a_not_found_rather_than_a_conflict()
    {
        await Assert.ThrowsAsync<NotFoundAppException>(
            () => h.Invites.ResendAsync(Guid.NewGuid(), actingUserId: null));
    }
}
