using System.Net;
using AuthService.Application.DTOs;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Email;
using AuthService.Options;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace AuthService.Application.Services;

/// <summary>
/// One pass of "who should be warned that their password is about to expire, and have they been?".
/// Kept apart from the hosted service that schedules it so the decision logic — the part that can email
/// the wrong people, or the same person repeatedly — is testable without a clock or a background thread.
/// <para>
/// The rules, each deliberate:
/// </para>
/// <list type="bullet">
/// <item><description>
/// <b>One email per threshold per password.</b> With reminders at 14/7/3/1 days, a user is emailed when
/// they first cross 14, again at 7, and so on — never twice for the same threshold, however often this
/// runs. <see cref="Domain.Entities.User.PasswordExpiryReminderSentDay"/> records the smallest threshold
/// already sent; changing the password clears it, which restarts the sequence for the next rotation.
/// </description></item>
/// <item><description>
/// <b>No catch-up.</b> Someone first seen with 2 days left is sent ONE email (the 3-day threshold), not
/// three for the thresholds they already sailed past.
/// </description></item>
/// <item><description>
/// <b>Only marked sent if the mail actually went.</b> A failed send is retried on the next pass rather
/// than recorded as done, so an SMTP outage delays a warning instead of silently dropping it.
/// </description></item>
/// <item><description>
/// <b>Only people it can help.</b> Active, local, with a password, and not already blocked: an expired
/// or temporary-password account cannot use a warning, and a Google account has no password to rotate.
/// </description></item>
/// </list>
/// </summary>
public class PasswordExpiryReminderSweeper(
    AuthDbContext db,
    PasswordPolicyAppService policyService,
    IEmailSender email,
    IOptions<SmtpOptions> smtpOptions,
    IOptions<PasswordExpiryReminderOptions> options,
    AuditLogAppService auditLog,
    ILogger<PasswordExpiryReminderSweeper> logger)
{
    private readonly SmtpOptions _smtp = smtpOptions.Value;

    /// <returns>How many reminder emails were sent.</returns>
    public async Task<int> RunAsync(DateTimeOffset? asOf = null, CancellationToken ct = default)
    {
        var now = asOf ?? DateTimeOffset.UtcNow;
        var policy = await policyService.GetPolicyAsync(ct);

        var thresholds = policy.Notifications.LeadDays is { Count: > 0 } lead
            ? lead.OrderBy(d => d).ToList()
            : [];
        if (!policy.Notifications.Email || thresholds.Count == 0)
        {
            return 0;
        }

        if (!email.IsEnabled)
        {
            // Unconfigured mail is a normal state here, not a fault — the in-app banner still works.
            logger.LogInformation("Password-expiry reminders are enabled but no mail provider is configured; skipping.");
            return 0;
        }

        var sent = 0;
        var batchSize = Math.Max(1, options.Value.BatchSize);

        // Ids first, users second. A uuid list is small even for a large directory, and loading users by
        // id in chunks avoids keyset paging on a Guid — whose comparison operator does not translate to
        // SQL portably, and would work on the in-memory test provider while failing against PostgreSQL.
        var candidateIds = await db.Users
            .AsNoTracking()
            .Where(u => u.Status == UserStatus.Active
                        && u.AuthProvider == AuthProvider.Local
                        && u.PasswordHash != null
                        && !u.MustChangePassword)
            .OrderBy(u => u.Id)
            .Select(u => u.Id)
            .ToListAsync(ct);

        foreach (var chunk in candidateIds.Chunk(batchSize))
        {
            ct.ThrowIfCancellationRequested();
            var batch = await db.Users.Where(u => chunk.Contains(u.Id)).ToListAsync(ct);

            foreach (var user in batch)
            {
                var status = PasswordPolicyAppService.Evaluate(user, policy, now);
                if (status.IsExpired || status.ExpiresAt is null || status.DaysRemaining is not { } daysRemaining)
                {
                    continue;
                }

                // The smallest threshold this user has reached: 5 days left with 14/7/3/1 → 7.
                var bucket = thresholds.Where(t => daysRemaining <= t).Select(t => (int?)t).FirstOrDefault();
                if (bucket is null) continue; // not yet inside the widest window

                if (user.PasswordExpiryReminderSentDay is { } already && already <= bucket)
                {
                    continue; // this threshold (or a nearer one) was already sent for this password
                }

                var (subject, html, text) = BuildReminderEmail(user.Name, daysRemaining, status.ExpiresAt.Value, _smtp.AppBaseUrl);
                if (!await email.SendAsync(user.Email, user.Name, subject, html, text, ct))
                {
                    logger.LogWarning("Could not send a password-expiry reminder to user {UserId}; will retry on the next sweep.", user.Id);
                    continue;
                }

                user.PasswordExpiryReminderSentDay = bucket;
                await db.SaveChangesAsync(ct);
                sent++;

                await auditLog.WriteHostAsync(
                    user.Id, user.Name, "auth.password_expiry_reminder_sent",
                    AuditLogAppService.Modules.Authentication, AuditLogAppService.Categories.Auth,
                    entityType: "User", entityId: user.Id.ToString(), entityLabel: user.Email,
                    details: $"Password expires in {daysRemaining} day(s) ({status.ExpiresAt.Value:u}); reminder for the {bucket}-day threshold emailed.",
                    authMethod: "System", ct: ct);
            }

            // The batch's rows stay tracked otherwise, and a directory of thousands would accumulate in memory.
            db.ChangeTracker.Clear();
        }

        if (sent > 0)
        {
            logger.LogInformation("Password-expiry reminders: {Count} email(s) sent.", sent);
        }

        return sent;
    }

    private static (string Subject, string Html, string Text) BuildReminderEmail(
        string name, int daysRemaining, DateTimeOffset expiresAt, string appBaseUrl)
    {
        var when = daysRemaining <= 1 ? "tomorrow" : $"in {daysRemaining} days";
        var subject = daysRemaining <= 1
            ? "Your OmniConnect password expires tomorrow"
            : $"Your OmniConnect password expires in {daysRemaining} days";
        var expiresText = expiresAt.UtcDateTime.ToString("dddd, d MMMM yyyy 'at' HH:mm 'UTC'");
        var link = string.IsNullOrWhiteSpace(appBaseUrl) ? string.Empty : $"{appBaseUrl.TrimEnd('/')}/profile";

        var button = link.Length == 0 ? string.Empty : $"""
                <p style="margin:0 0 28px;">
                  <a href="{link}"
                     style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;
                            padding:13px 28px;border-radius:8px;font-size:14px;font-weight:600;
                            letter-spacing:0.01em;">
                    Change My Password
                  </a>
                </p>
            """;

        var html = $"""
            <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f8fafc;padding:32px 16px;">
              <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;">

                <div style="margin:0 0 20px;">
                  <h1 style="margin:0 0 4px;font-size:20px;color:#0f172a;">Your password expires {when}</h1>
                  <p style="margin:0;font-size:13px;color:#94a3b8;">OmniConnect Account Security</p>
                </div>

                <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#475569;">
                  Dear <strong style="color:#0f172a;">{WebUtility.HtmlEncode(name)}</strong>,<br/><br/>
                  In line with your organisation's password policy, your OmniConnect password will expire on
                  <strong>{expiresText}</strong>. Once it has expired you will not be able to use OmniConnect
                  until you set a new one. Changing it now takes less than a minute.
                </p>
            {button}
                <div style="background:#f1f5f9;border-radius:8px;padding:14px 16px;margin:0 0 20px;">
                  <p style="margin:0;font-size:12.5px;line-height:1.6;color:#475569;">
                    Sign in, open your profile and choose <strong>Change password</strong>. If you can no
                    longer remember your current password, use <strong>Forgot password</strong> on the sign-in page.
                  </p>
                </div>

                <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;" />

                <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">
                  This is an automated message from OmniConnect Account Security. Please do not reply
                  to this email. For assistance, contact your administrator.
                </p>
              </div>
            </div>
            """;

        var text = $"""
            Your password expires {when} — OmniConnect Account Security

            Dear {name},

            In line with your organisation's password policy, your OmniConnect password will expire on
            {expiresText}. Once it has expired you will not be able to use OmniConnect until you set a
            new one.

            {(link.Length == 0 ? "Sign in, open your profile and choose Change password." : $"Change it now: {link}")}

            If you can no longer remember your current password, use "Forgot password" on the sign-in page.

            This is an automated message. Please do not reply to this email.
            """;

        return (subject, html, text);
    }
}
