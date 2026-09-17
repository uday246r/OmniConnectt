namespace AuthService.Domain.Entities;

/// <summary>
/// A single-use, short-lived link letting an existing local user set a new password after clicking
/// "Forgot password?". Deliberately mirrors <see cref="SetPasswordInvite"/>: the raw token exists only
/// in the email that was sent, this table only ever stores its SHA-256 hash, and issuing a new one
/// revokes whatever was outstanding so a mailbox can never hold two live reset links at once.
///
/// The one property that sets this apart from an invite is how short <see cref="ExpiresAt"/> is —
/// minutes, not hours. An invite is mailed the moment an account is created and nobody but the new
/// hire could have asked for it, so a longer window is harmless. A reset link is requested by typing
/// an email address into an anonymous form, which anyone can do for any address; keeping the window to
/// a few minutes is what keeps a link that leaks (a shared inbox, a forwarded message, a screenshot)
/// from being useful for long.
/// </summary>
public class PasswordResetToken
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }
    public User? User { get; set; }

    /// <summary>SHA-256 of the raw token. The raw value exists only in the email that was sent.</summary>
    public required string TokenHash { get; set; }

    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>Set the moment the token is redeemed, which is what makes it single-use.</summary>
    public DateTimeOffset? UsedAt { get; set; }

    /// <summary>
    /// Set when a newer reset request supersedes this one, so asking for another link cannot leave
    /// two live links for the same account.
    /// </summary>
    public DateTimeOffset? RevokedAt { get; set; }

    /// <summary>Caller's IP address at the time the reset was requested, kept for the audit trail only.</summary>
    public string? RequestedFromIp { get; set; }

    public bool IsRedeemable => UsedAt is null && RevokedAt is null && ExpiresAt > DateTimeOffset.UtcNow;
}
