using System.Security.Cryptography;
using System.Text;
using AuthService.Domain.Entities;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Email;
using AuthService.Infrastructure.Security;
using AuthService.Options;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace AuthService.Application.Services;

/// <summary>
/// Issues and redeems single-use set-password invitations.
///
/// The invariant worth stating plainly: <b>the raw token exists only in the email</b>. It is
/// generated here, hashed immediately, and the hash is what reaches the database — the same handling
/// <see cref="RefreshTokenService"/> gives refresh tokens. Nothing in the system can recover a link
/// after it is sent, which is precisely what makes the mechanism safe to email.
///
/// Issuing an invite revokes any earlier one for the same user, so re-sending can never leave two
/// live links pointing at one account.
/// </summary>
public class SetPasswordInviteService(
    AuthDbContext db,
    IEmailSender email,
    PasswordHasher passwordHasher,
    IOptions<SmtpOptions> smtpOptions,
    IOptions<PasswordPolicyOptions> passwordPolicyOptions,
    ILogger<SetPasswordInviteService> logger)
{
    private readonly SmtpOptions _smtp = smtpOptions.Value;
    private readonly PasswordPolicyOptions _passwordPolicy = passwordPolicyOptions.Value;

    public bool IsEnabled => email.IsEnabled;

    /// <summary>
    /// Creates an invite and emails it. Never throws for mail-related reasons: account provisioning
    /// has already succeeded by the time this runs, and must not be undone by a mail outage.
    /// Returns true only when a message was actually accepted for delivery.
    ///
    /// The caller commits — this mutates tracked entities without saving, so the invite lands in the
    /// same transaction as the account it belongs to.
    /// </summary>
    public async Task<bool> IssueAsync(User user, Guid? actingUserId, CancellationToken ct = default)
    {
        if (!email.IsEnabled)
        {
            return false;
        }

        var now = DateTimeOffset.UtcNow;

        // Supersede anything outstanding so a re-invite cannot leave two usable links.
        var live = await db.SetPasswordInvites
            .Where(i => i.UserId == user.Id && i.UsedAt == null && i.RevokedAt == null)
            .ToListAsync(ct);
        foreach (var stale in live)
        {
            stale.RevokedAt = now;
        }

        var rawToken = GenerateRawToken();

        db.SetPasswordInvites.Add(new SetPasswordInvite
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            TokenHash = Hash(rawToken),
            CreatedAt = now,
            ExpiresAt = now.AddHours(Math.Max(1, _smtp.InviteValidHours)),
            CreatedBy = actingUserId,
        });

        var link = $"{_smtp.AppBaseUrl.TrimEnd('/')}/set-password?token={Uri.EscapeDataString(rawToken)}";
        var (subject, html, text) = BuildInviteEmail(user.Name, link, _smtp.InviteValidHours);

        return await email.SendAsync(user.Email, user.Name, subject, html, text, ct);
    }

    /// <summary>
    /// Validates a raw token without consuming it, so the set-password page can show a meaningful
    /// error before the user types a password rather than after.
    /// </summary>
    public async Task<SetPasswordInvite?> FindRedeemableAsync(string rawToken, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(rawToken)) return null;

        var hash = Hash(rawToken);
        var invite = await db.SetPasswordInvites
            .Include(i => i.User)
            .FirstOrDefaultAsync(i => i.TokenHash == hash, ct);

        return invite is not null && invite.IsRedeemable ? invite : null;
    }

    /// <summary>
    /// Consumes the invite and sets the password. Marking it used and writing the password happen in
    /// one SaveChanges so a link can never be spent without the password actually changing.
    ///
    /// Returns the policy failure message when the password is rejected, leaving the invite intact so
    /// the user can simply try a stronger one. Returns null on success.
    /// </summary>
    public async Task<string?> RedeemAsync(string rawToken, string newPassword, CancellationToken ct = default)
    {
        var invite = await FindRedeemableAsync(rawToken, ct);
        if (invite?.User is null) return "This link is invalid, has already been used, or has expired.";

        // The same policy the change-password flow enforces — a password chosen through an invite is
        // no less privileged than one set from inside the app.
        var policyProblem = _passwordPolicy.Validate(newPassword);
        if (policyProblem is not null) return policyProblem;

        invite.UsedAt = DateTimeOffset.UtcNow;
        invite.User.PasswordHash = passwordHasher.Hash(invite.User, newPassword);
        // The user chose this password themselves, so the forced-change-on-first-login that exists
        // for administrator-generated temporary passwords would be pure friction here.
        invite.User.MustChangePassword = false;

        await db.SaveChangesAsync(ct);
        logger.LogInformation("Set-password invite redeemed for user {UserId}.", invite.UserId);
        return null;
    }

private static (string Subject, string Html, string Text) BuildInviteEmail(string name, string link, int validHours)
{
    const string subject = "You've been invited to OmniConnect — Set your password to get started";

    // Inline styles only: every major mail client strips <style> blocks, and several strip
    // classes as well. Kept close to the product's own palette without depending on it.
    var html = $"""
        <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f8fafc;padding:32px 16px;">
          <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;">

            <div style="margin:0 0 20px;">
              <h1 style="margin:0 0 4px;font-size:22px;color:#0f172a;">Welcome to OmniConnect 👋</h1>
              <p style="margin:0;font-size:13px;color:#94a3b8;">Your account is ready — one step to go.</p>
            </div>

            <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#475569;">
              Hello <strong style="color:#0f172a;">{System.Net.WebUtility.HtmlEncode(name)}</strong>,<br/><br/>
              An account has been created for you on OmniConnect. To activate it and set your own
              password, click the button below. This is the only way to access your account.
            </p>

            <p style="margin:0 0 28px;">
              <a href="{link}"
                 style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;
                        padding:13px 28px;border-radius:8px;font-size:14px;font-weight:600;
                        letter-spacing:0.01em;">
                Set My Password &amp; Log In
              </a>
            </p>

            <div style="background:#f1f5f9;border-radius:8px;padding:14px 16px;margin:0 0 20px;">
              <p style="margin:0 0 6px;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">What happens next?</p>
              <ol style="margin:0;padding:0 0 0 18px;font-size:13px;line-height:1.8;color:#475569;">
                <li>Click the button above to open a secure page.</li>
                <li>Choose a strong password for your account.</li>
                <li>Log in using your email address and the password you just set.</li>
              </ol>
            </div>

            <p style="margin:0 0 8px;font-size:12.5px;line-height:1.6;color:#64748b;">
              ⏱️ This link can be used <strong>once</strong> and expires in
              <strong>{validHours} hour{(validHours == 1 ? "" : "s")}</strong>.
              If it expires, ask your administrator to resend the invite.
            </p>

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;" />

            <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">
              If you were not expecting this email, you can safely ignore it —
              your account cannot be accessed without setting a password through this link.
            </p>
          </div>
        </div>
        """;

    var text = $"""
        Welcome to OmniConnect

        Hello {name},

        An account has been created for you on OmniConnect. To activate it and set your own password,
        visit the link below. This is the only way to access your account.

        {link}

        What happens next?
          1. Open the link above.
          2. Choose a strong password.
          3. Log in with your email address and the password you just set.

        This link can be used once and expires in {validHours} hour{(validHours == 1 ? "" : "s")}.
        If it expires, ask your administrator to resend the invite.

        If you were not expecting this email, you can safely ignore it.
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
