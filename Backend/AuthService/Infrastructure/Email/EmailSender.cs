using AuthService.Options;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Options;
using MimeKit;

namespace AuthService.Infrastructure.Email;

/// <summary>
/// SMTP delivery over MailKit. Implements <see cref="IEmailSender"/> for the default deployment.
/// To switch providers (SendGrid, AWS SES, Mailgun, etc.), create a new class that implements
/// <see cref="IEmailSender"/> and register it in Program.cs instead of this one.
/// </summary>
public class SmtpEmailSender(IOptions<SmtpOptions> options, ILogger<SmtpEmailSender> logger) : IEmailSender{
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
