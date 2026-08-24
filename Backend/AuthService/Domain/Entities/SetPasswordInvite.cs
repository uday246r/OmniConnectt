namespace AuthService.Domain.Entities;

/// <summary>
/// A single-use, time-limited invitation letting a newly provisioned user choose their own password.
///
/// This exists so a working credential never has to travel by email. The alternative — mailing the
/// generated temporary password — leaves a valid secret sitting in a mailbox indefinitely, readable
/// by anyone who later gains access to it and impossible to retract once sent. An invite link is
/// revocable, expires on its own, and is worthless the moment it has been used.
///
/// Deliberately mirrors <see cref="RefreshToken"/>: the raw token is returned to the caller exactly
/// once and only its SHA-256 hash is persisted, so a database disclosure yields nothing usable. The
/// same reasoning applies to both — see RefreshTokenService for the shared hashing approach.
///
/// The existing encrypted temporary-password flow is unchanged and remains the fallback for users
/// who cannot receive mail; the two coexist rather than one replacing the other.
/// </summary>
public class SetPasswordInvite
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }
    public User? User { get; set; }

    /// <summary>SHA-256 of the raw token. The raw value exists only in the email that was sent.</summary>
    public required string TokenHash { get; set; }

    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>Set the moment the invite is redeemed, which is what makes it single-use.</summary>
    public DateTimeOffset? UsedAt { get; set; }

    /// <summary>
    /// Set when a newer invite supersedes this one, so re-inviting a user cannot leave two live
    /// links for the same account.
    /// </summary>
    public DateTimeOffset? RevokedAt { get; set; }

    /// <summary>Who triggered the invite — the maker on creation, or an admin re-sending it.</summary>
    public Guid? CreatedBy { get; set; }

    public bool IsRedeemable => UsedAt is null && RevokedAt is null && ExpiresAt > DateTimeOffset.UtcNow;
}
