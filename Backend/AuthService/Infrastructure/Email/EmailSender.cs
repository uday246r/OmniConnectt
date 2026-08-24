using AuthService.Options;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Options;
using MimeKit;

namespace AuthService.Infrastructure.Email;

public interface IEmailSender
{
    /// <summary>True when the deployment has SMTP configured; callers use it to decide whether to promise a mail.</summary>
    bool IsEnabled { get; }

    /// <summary>
    /// Attempts delivery. Returns false rather than throwing on failure — see the class remarks for
    /// why a mail problem must never fail the operation that triggered it.
    /// </summary>
    Task<bool> SendAsync(string toAddress, string toName, string subject, string htmlBody, string textBody, CancellationToken ct = default);
}

/// <summary>
/// SMTP delivery over MailKit.
///
/// Two deliberate design choices:
///
/// 1. <b>Failure is never fatal.</b> Sending happens after an account has already been created, and
///    an unreachable mail server must not undo that — otherwise a transient SMTP outage becomes a
///    failed user-provisioning request, and the maker is left unsure whether the account exists.
///    Failures are logged and reported to the caller as `false`, which surfaces as a warning while
///    the encrypted temporary-password fallback stays available.
///
/// 2. <b>Unconfigured is a normal state.</b> Without SMTP settings this reports IsEnabled = false and
///    sends nothing, exactly as Google SSO is inert without a Client ID. That keeps local development
///    and any deployment that has not set up mail yet fully functional.
///
/// A plain-text alternative accompanies every HTML body: some corporate mail clients strip HTML
/// entirely, and an invite whose link is invisible is the same as no invite at all.
/// </summary>
public class EmailSender(IOptions<SmtpOptions> options, ILogger<EmailSender> logger) : IEmailSender
{
    private readonly SmtpOptions _smtp = options.Value;

    public bool IsEnabled => _smtp.IsConfigured;

    public async Task<bool> SendAsync(
        string toAddress, string toName, string subject, string htmlBody, string textBody, CancellationToken ct = default)
    {
        if (!IsEnabled)
        {
            logger.LogInformation(
                "Email not sent to {Recipient}: SMTP is not configured for this deployment.", toAddress);
            return false;
        }

        try
        {
            var message = new MimeMessage();
            message.From.Add(new MailboxAddress(_smtp.FromName, _smtp.ResolvedFromAddress));
            message.To.Add(new MailboxAddress(toName, toAddress));
            message.Subject = subject;
            message.Body = new BodyBuilder { HtmlBody = htmlBody, TextBody = textBody }.ToMessageBody();

            using var client = new SmtpClient();

            // 465 is implicit TLS; everything else negotiates STARTTLS and REQUIRES it to succeed.
            // SecureSocketOptions.Auto is avoided deliberately: it silently accepts a plaintext
            // session when a server declines to upgrade, which would put credentials and invite
            // links on the wire in clear text.
            var secureOptions = _smtp.Port == 465
                ? SecureSocketOptions.SslOnConnect
                : SecureSocketOptions.StartTls;

            await client.ConnectAsync(_smtp.Host, _smtp.Port, secureOptions, ct);

            // Some internal relays accept mail from trusted hosts without authentication.
            if (!string.IsNullOrWhiteSpace(_smtp.Username))
            {
                await client.AuthenticateAsync(_smtp.Username, _smtp.Password, ct);
            }

            await client.SendAsync(message, ct);
            await client.DisconnectAsync(true, ct);

            logger.LogInformation("Email '{Subject}' sent to {Recipient}.", subject, toAddress);
            return true;
        }
        catch (Exception ex)
        {
            // Intentionally broad: MailKit surfaces a wide range of socket, TLS, authentication and
            // protocol exceptions, and the caller's response is identical for all of them — carry on
            // and report that the mail did not go out.
            logger.LogError(ex, "Failed to send email '{Subject}' to {Recipient}.", subject, toAddress);
            return false;
        }
    }
}
