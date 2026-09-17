using System.Security.Cryptography;
using System.Text;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Email;
using AuthService.Infrastructure.Security;
using AuthService.Options;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace AuthService.Application.Services;

/// <summary>
/// Issues and redeems single-use, short-lived "forgot password" links.
///
/// Deliberately mirrors <see cref="SetPasswordInviteService"/> — same raw-token-only-in-the-email
/// handling, same supersede-the-previous-one-on-reissue behaviour — with one difference load-bearing
/// enough to be its own type rather than a flag on the invite service: an invite is mailed the moment
/// an account is created, so only the new hire could plausibly want it, while a reset link is handed
/// out in response to <b>anyone</b> typing an email address into an anonymous form. That is what
/// drives every refusal below: the response to the caller never reveals whether the address matched an
/// account, and the link itself expires in minutes rather than hours.
/// </summary>
public class PasswordResetService(
    AuthDbContext db,
    IEmailSender email,
    PasswordHasher passwordHasher,
    RefreshTokenService refreshTokenService,
    IOptions<SmtpOptions> smtpOptions,
    IOptions<PasswordPolicyOptions> passwordPolicyOptions,
    AuditLogAppService auditLog,
    ILogger<PasswordResetService> logger)
{
    private readonly SmtpOptions _smtp = smtpOptions.Value;
    private readonly PasswordPolicyOptions _passwordPolicy = passwordPolicyOptions.Value;

    public bool IsEnabled => email.IsEnabled;

    /// <summary>
    /// Looks up the address and, only when it resolves to an active local account, emails a fresh
    /// reset link and revokes any earlier one for the same user.
    ///
    /// Deliberately returns nothing and never throws for "no such account", "this account signs in
    /// with Google", or "email is not configured" — the caller (AuthController) sends back the exact
    /// same generic message regardless, which is what stops this endpoint being usable to test which
    /// email addresses have accounts. All of that IS still written to the audit trail below, for an
    /// administrator who needs to see the real picture; it is only ever withheld from the anonymous
    /// caller who triggered it.
    /// </summary>
    public async Task RequestResetAsync(string emailAddress, string? clientIp, string? userAgent, CancellationToken ct = default)
    {
        var normalizedEmail = emailAddress.Trim().ToLowerInvariant();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == normalizedEmail, ct);

        // Every one of these is indistinguishable from "no such address" to the caller, on purpose —
        // see the remarks above. Nothing is sent and nothing further happens for any of them.
        if (user is null || user.AuthProvider != AuthProvider.Local || user.Status != UserStatus.Active)
        {
            logger.LogInformation(
                "Password reset requested for {Email}, which does not match a resettable local account.",
                normalizedEmail);
            return;
        }

        if (!email.IsEnabled)
        {
            logger.LogWarning(
                "Password reset requested for {Email} but SMTP is not configured — no link could be sent.",
                normalizedEmail);
            return;
        }

        var now = DateTimeOffset.UtcNow;

        // Supersede anything outstanding so a second request (or an impatient double-click) cannot
        // leave two live links, exactly as SetPasswordInviteService does for invites.
        var live = await db.PasswordResetTokens
            .Where(t => t.UserId == user.Id && t.UsedAt == null && t.RevokedAt == null)
            .ToListAsync(ct);
        foreach (var stale in live)
        {
            stale.RevokedAt = now;
        }

        var rawToken = GenerateRawToken();
        var validMinutes = Math.Max(1, _smtp.ResetPasswordValidMinutes);

        db.PasswordResetTokens.Add(new PasswordResetToken
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            TokenHash = Hash(rawToken),
            CreatedAt = now,
            ExpiresAt = now.AddMinutes(validMinutes),
            RequestedFromIp = clientIp,
        });

        var link = $"{_smtp.AppBaseUrl.TrimEnd('/')}/reset-password?token={Uri.EscapeDataString(rawToken)}";
        var (subject, html, text) = BuildResetEmail(user.Name, link, validMinutes, now, clientIp);

        var sent = await email.SendAsync(user.Email, user.Name, subject, html, text, ct);
        await db.SaveChangesAsync(ct);

        // Attributed to the account itself: the caller here is anonymous, so there is no acting-user
        // identity to record other than the one whose password may be about to change.
        await auditLog.WriteHostAsync(
            user.Id, user.Name, "auth.password_reset_requested",
            AuditLogAppService.Modules.Authentication, AuditLogAppService.Categories.Auth,
            entityType: "User", entityId: user.Id.ToString(), entityLabel: user.Email,
            details: sent
                ? $"Password reset link sent to {user.Email}, valid for {validMinutes} minute(s). Any earlier reset link for this account was revoked."
                : $"Password reset link for {user.Email} could not be delivered. Any earlier reset link for this account was revoked and is no longer usable.",
            sourceIp: clientIp, userAgent: userAgent, authMethod: "Local",
            result: sent ? "Success" : "Failure",
            failureReason: sent ? null : "Reset email could not be delivered",
            ct: ct);
    }

    /// <summary>
    /// Validates a raw token without consuming it, so the reset page can show a meaningful error
    /// before the user types a password rather than after.
    /// </summary>
    public async Task<PasswordResetToken?> FindRedeemableAsync(string rawToken, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(rawToken)) return null;

        var hash = Hash(rawToken);
        var token = await db.PasswordResetTokens
            .Include(t => t.User)
            .FirstOrDefaultAsync(t => t.TokenHash == hash, ct);

        return token is not null && token.IsRedeemable ? token : null;
    }

    /// <summary>
    /// Consumes the token and sets the password. Marking it used and writing the password happen in
    /// one SaveChanges so a link can never be spent without the password actually changing.
    ///
    /// Every other active session for the account is revoked — unlike a self-service password change
    /// there is no "current session" to spare, since the caller here has no session at all: whoever
    /// clicked the link is, by definition, signed out. Leaving old sessions alive would defeat the
    /// point of a reset requested because a password was believed compromised.
    ///
    /// Returns the policy failure message when the password is rejected, leaving the token intact so
    /// the user can simply try a stronger one. Returns null on success.
    /// </summary>
    public async Task<string?> RedeemAsync(string rawToken, string newPassword, CancellationToken ct = default)
    {
        var token = await FindRedeemableAsync(rawToken, ct);
        if (token?.User is null) return "This link is invalid, has already been used, or has expired.";

        var policyProblem = _passwordPolicy.Validate(newPassword);
        if (policyProblem is not null) return policyProblem;

        token.UsedAt = DateTimeOffset.UtcNow;
        token.User.PasswordHash = passwordHasher.Hash(token.User, newPassword);
        // The user proved control of the mailbox and chose this password themselves, so the forced
        // first-login rotation that exists for administrator-generated temporary passwords is not
        // relevant here — same reasoning SetPasswordInviteService applies on redemption.
        token.User.MustChangePassword = false;
        token.User.UpdatedAt = DateTimeOffset.UtcNow;

        await db.SaveChangesAsync(ct);

        var sessionsEnded = await refreshTokenService.RevokeAllForUserExceptAsync(token.UserId, keepRawToken: null, ct);

        logger.LogInformation("Password reset redeemed for user {UserId}.", token.UserId);

        await auditLog.WriteHostAsync(
            token.UserId, token.User.Name, "auth.password_reset_completed",
            AuditLogAppService.Modules.Authentication, AuditLogAppService.Categories.Auth,
            entityType: "User", entityId: token.UserId.ToString(), entityLabel: token.User.Email,
            details: sessionsEnded > 0
                ? $"Password reset through an emailed link. The link is now spent. {sessionsEnded} other session(s) signed out."
                : "Password reset through an emailed link. The link is now spent.",
            authMethod: "Local", ct: ct);

        return null;
    }

    private static (string Subject, string Html, string Text) BuildResetEmail(
        string name, string link, int validMinutes, DateTimeOffset requestedAt, string? clientIp)
    {
        const string subject = "Reset your OmniConnect password";

        // Formal, bank-statement register throughout — the "we noticed a request on your account,
        // here is exactly when and where it came from" tone a financial institution uses for anything
        // touching a credential, deliberately more clinical than the welcome/invite email's voice.
        var requestedAtText = requestedAt.UtcDateTime.ToString("dddd, d MMMM yyyy 'at' HH:mm 'UTC'");
        var originText = string.IsNullOrWhiteSpace(clientIp) ? "" : $" from IP address {clientIp}";

        var html = $"""
            <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f8fafc;padding:32px 16px;">
              <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;">

                <div style="margin:0 0 20px;">
                  <h1 style="margin:0 0 4px;font-size:20px;color:#0f172a;">Password reset request</h1>
                  <p style="margin:0;font-size:13px;color:#94a3b8;">OmniConnect Account Security</p>
                </div>

                <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#475569;">
                  Dear <strong style="color:#0f172a;">{System.Net.WebUtility.HtmlEncode(name)}</strong>,<br/><br/>
                  We received a request to reset the password on your OmniConnect account on
                  {requestedAtText}{System.Net.WebUtility.HtmlEncode(originText)}. If you made this request,
                  please use the button below to choose a new password.
                </p>

                <p style="margin:0 0 28px;">
                  <a href="{link}"
                     style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;
                            padding:13px 28px;border-radius:8px;font-size:14px;font-weight:600;
                            letter-spacing:0.01em;">
                    Reset My Password
                  </a>
                </p>

                <div style="background:#fef3f2;border:1px solid #fecdca;border-radius:8px;padding:14px 16px;margin:0 0 20px;">
                  <p style="margin:0;font-size:12.5px;line-height:1.6;color:#b42318;">
                    ⏱️ For your security, this link expires in <strong>{validMinutes} minute{(validMinutes == 1 ? "" : "s")}</strong>
                    and can only be used once. After it expires you will need to submit a new request.
                  </p>
                </div>

                <div style="background:#f1f5f9;border-radius:8px;padding:14px 16px;margin:0 0 20px;">
                  <p style="margin:0;font-size:12.5px;line-height:1.6;color:#475569;">
                    <strong>Did not request this?</strong> Your password has not been changed and no
                    further action is required. However, if you did not request a password reset, we
                    recommend you review your account activity and contact your administrator.
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
            Password reset request — OmniConnect Account Security

            Dear {name},

            We received a request to reset the password on your OmniConnect account on
            {requestedAtText}{originText}. If you made this request, use the link below to choose a
            new password.

            {link}

            For your security, this link expires in {validMinutes} minute{(validMinutes == 1 ? "" : "s")}
            and can only be used once.

            Did not request this? Your password has not been changed and no further action is
            required. If you did not request a password reset, we recommend you review your account
            activity and contact your administrator.

            This is an automated message. Please do not reply to this email.
            """;

        return (subject, html, text);
    }

    /// <summary>256 bits of entropy, URL-safe so it survives being placed in a query string.</summary>
    private static string GenerateRawToken() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');

    private static string Hash(string rawToken) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(rawToken)));
}
