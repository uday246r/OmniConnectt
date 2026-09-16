namespace AuthService.Infrastructure.Email;

/// <summary>
/// Abstraction over any email delivery provider.
///
/// The plug-and-play seam: swap the concrete implementation in Program.cs (currently
/// <see cref="SmtpEmailSender"/>) to change providers without touching any service that sends mail.
/// Implementations must honour the two invariants below.
///
/// 1. <b>Failure is never fatal.</b> Sending happens after an account has already been created or
///    approved. An unreachable mail server must not undo that — otherwise a transient SMTP outage
///    becomes a failed user-provisioning request. Failures are logged and reported to the caller
///    as <c>false</c>.
///
/// 2. <b>Unconfigured is a normal state.</b> Without provider settings <see cref="IsEnabled"/>
///    returns false and nothing is sent. This keeps local development and any deployment that has
///    not set up email yet fully functional.
/// </summary>
public interface IEmailSender
{
    /// <summary>
    /// True when this deployment has a mail provider configured and ready to send.
    /// Callers use this to decide whether to promise the user that a mail was sent.
    /// </summary>
    bool IsEnabled { get; }

    /// <summary>
    /// Attempts email delivery. Returns false rather than throwing on failure — see the interface
    /// remarks for why a mail problem must never fail the operation that triggered it.
    /// </summary>
    /// <param name="toAddress">Recipient email address.</param>
    /// <param name="toName">Recipient display name (used in the To: header).</param>
    /// <param name="subject">Email subject line.</param>
    /// <param name="htmlBody">HTML email body (inline styles only — mail clients strip &lt;style&gt; blocks).</param>
    /// <param name="textBody">Plain-text fallback body for clients that strip HTML.</param>
    /// <param name="ct">Cancellation token.</param>
    Task<bool> SendAsync(
        string toAddress,
        string toName,
        string subject,
        string htmlBody,
        string textBody,
        CancellationToken ct = default);
}