using AuthService.Application.DTOs;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Security;
using AuthService.Options;
using Google.Apis.Auth;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace AuthService.Application.Services;

public class InvalidCredentialsException() : Exception("Invalid email or password.");
public class AccountInactiveException() : Exception("This account is inactive. Contact an administrator.");
public class InvalidRefreshTokenException() : Exception("Refresh session is invalid or has expired.");
public class SsoNotConfiguredException() : Exception("Google Sign-In is not configured for this deployment.");
public class SsoDomainNotAllowedException(string domain) : Exception($"The domain '{domain}' is not allowed to sign in via Google.");
public class SsoAccountNotFoundException() : Exception("No active account is provisioned for this Google identity. Ask an administrator to create one.");

/// <summary>
/// A self-service password change was refused. Distinct from InvalidCredentialsException because the
/// caller IS authenticated here — this must surface as a 400 (bad input), not a 401, or the frontend's
/// refresh-and-retry interceptor treats it as an expired session and signs the user out mid-form.
/// </summary>
public class PasswordChangeRejectedException(string message) : Exception(message);

public record AuthResult(string AccessToken, DateTimeOffset ExpiresAt, string RefreshToken, DateTimeOffset RefreshExpiresAt, CurrentUserDto User);

public class AuthAppService(
    AuthDbContext db,
    PasswordHasher passwordHasher,
    JwtTokenService jwtTokenService,
    RefreshTokenService refreshTokenService,
    PermissionClaimsBuilder permissionClaimsBuilder,
    AuditLogAppService auditLog,
    IOptions<GoogleAuthOptions> googleOptions,
    IOptions<PasswordPolicyOptions> passwordPolicyOptions)
{
    private const string ServiceName = "AuthService";
    private readonly GoogleAuthOptions _google = googleOptions.Value;
    private readonly PasswordPolicyOptions _passwordPolicy = passwordPolicyOptions.Value;

    public async Task<AuthResult> LoginAsync(string email, string password, string? clientIp, string? userAgent, CancellationToken ct = default)
    {
        var normalizedEmail = email.Trim().ToLowerInvariant();
        var user = await db.Users
            .Include(u => u.Role)
            .FirstOrDefaultAsync(u => u.Email == normalizedEmail, ct);

        // A Google-provisioned account has no PasswordHash at all — it can never satisfy a local
        // password check, so this falls through to the same InvalidCredentialsException as a wrong
        // password would. Deliberately not distinguished in the response (don't leak account
        // existence/type to an unauthenticated caller); FailureReason on the audit row is internal only.
        if (user is null || user.PasswordHash is null || !passwordHasher.Verify(user, user.PasswordHash, password))
        {
            await LogLoginFailureAsync(normalizedEmail, user, "Invalid email or password.", clientIp, userAgent, "Local", ct);
            throw new InvalidCredentialsException();
        }

        if (user.Status != UserStatus.Active)
        {
            await LogLoginFailureAsync(normalizedEmail, user, "Account is inactive.", clientIp, userAgent, "Local", ct);
            throw new AccountInactiveException();
        }

        user.LastLoginAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);

        var result = await IssueSessionAsync(user, clientIp, ct);

        await auditLog.WriteHostAsync(
            user.Id, user.Name, "auth.login_succeeded",
            AuditLogAppService.Modules.Authentication, AuditLogAppService.Categories.Auth,
            entityType: "User", entityId: user.Id.ToString(), details: $"{user.Email} signed in.",
            entityLabel: user.Email, sourceIp: clientIp, authMethod: "Local", userAgent: userAgent, ct: ct);

        return result;
    }

    /// <summary>
    /// Verifies a real Google ID token (cryptographic signature check against Google's own public
    /// keys via Google.Apis.Auth — never a fabricated check), confirms the email's domain is
    /// allow-listed, then signs in an ALREADY-PROVISIONED User row with AuthProvider=Google. SSO
    /// never auto-creates an account — an administrator still creates the User first (same
    /// UserAppService.CreateAsync flow as a Local account), just with AuthProvider=Google and no
    /// password.
    /// </summary>
    public async Task<AuthResult> GoogleLoginAsync(string idToken, string? clientIp, string? userAgent, CancellationToken ct = default)
    {
        if (!_google.IsConfigured)
        {
            throw new SsoNotConfiguredException();
        }

        GoogleJsonWebSignature.Payload payload;
        try
        {
            payload = await GoogleJsonWebSignature.ValidateAsync(idToken, new GoogleJsonWebSignature.ValidationSettings
            {
                Audience = [_google.ClientId],
            });
        }
        catch (InvalidJwtException)
        {
            await LogLoginFailureAsync("unknown", null, "Invalid or expired Google ID token.", clientIp, userAgent, "Google", ct);
            throw new InvalidCredentialsException();
        }

        var email = payload.Email.Trim().ToLowerInvariant();
        var domain = email.Contains('@') ? email[(email.IndexOf('@') + 1)..] : string.Empty;

        if (!_google.AllowedDomainsList.Contains(domain, StringComparer.OrdinalIgnoreCase))
        {
            await LogLoginFailureAsync(email, null, $"Domain '{domain}' is not in the allowed list.", clientIp, userAgent, "Google", ct);
            throw new SsoDomainNotAllowedException(domain);
        }

        var user = await db.Users
            .Include(u => u.Role)
            .FirstOrDefaultAsync(u => u.Email == email && u.AuthProvider == AuthProvider.Google, ct);

        if (user is null)
        {
            await LogLoginFailureAsync(email, null, "No Google-provisioned account exists for this email.", clientIp, userAgent, "Google", ct);
            throw new SsoAccountNotFoundException();
        }

        if (user.Status != UserStatus.Active)
        {
            await LogLoginFailureAsync(email, user, "Account is inactive.", clientIp, userAgent, "Google", ct);
            throw new AccountInactiveException();
        }

        user.LastLoginAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);

        var result = await IssueSessionAsync(user, clientIp, ct);

        await auditLog.WriteHostAsync(
            user.Id, user.Name, "auth.login_succeeded",
            AuditLogAppService.Modules.Authentication, AuditLogAppService.Categories.Auth,
            entityType: "User", entityId: user.Id.ToString(), details: $"{user.Email} signed in via Google.",
            entityLabel: user.Email, sourceIp: clientIp, authMethod: "Google", userAgent: userAgent, ct: ct);

        return result;
    }

    public SsoConfigDto GetSsoConfig() => new(
        _google.IsConfigured,
        _google.IsConfigured ? _google.AllowedDomainsList : [],
        // Only surfaced once fully configured, so a half-set-up deployment advertises nothing.
        _google.IsConfigured ? _google.ClientId : string.Empty);

    /// <summary>
    /// Every real failure path lands here — invalid credentials, inactive accounts, and every
    /// Google SSO rejection reason. ActorName falls back to the attempted email when no matching
    /// user exists, so the trail still shows who tried even for a login that never resolved to a
    /// real account — never a fabricated name.
    /// </summary>
    private Task LogLoginFailureAsync(string attemptedEmail, User? user, string failureReason, string? clientIp, string? userAgent, string authMethod, CancellationToken ct) =>
        auditLog.WriteHostAsync(
            user?.Id, user?.Name ?? attemptedEmail, "auth.login_failed",
            AuditLogAppService.Modules.Authentication, AuditLogAppService.Categories.Auth,
            entityType: "User", entityId: user?.Id.ToString(),
            details: $"Sign-in failed for {attemptedEmail}: {failureReason}",
            entityLabel: attemptedEmail, sourceIp: clientIp, result: "Failure",
            failureReason: failureReason, authMethod: authMethod, userAgent: userAgent, ct: ct);

    public async Task<AuthResult> RefreshAsync(string rawRefreshToken, string? clientIp, string? userAgent = null, CancellationToken ct = default)
    {
        var rotated = await refreshTokenService.RotateAsync(rawRefreshToken, clientIp, ct);
        if (!rotated.Succeeded)
        {
            /*
             * A refused rotation is not automatically interesting — a token expiring overnight is the
             * system working. Reuse is the exception, and it is the most serious authentication event
             * this service can observe: an already-rotated token was presented a second time, which
             * means either the legitimate cookie was replayed or someone else holds a copy. Those are
             * indistinguishable from here, so RotateAsync treats it as theft and revokes every active
             * session for the account.
             *
             * Until now that happened in complete silence. The user was signed out of every device at
             * once, support had nothing to look at, and the strongest available indicator of a stolen
             * credential left no record anywhere.
             */
            if (rotated.Failure == RefreshFailureReason.Reused)
            {
                var victim = rotated.AffectedUserId;
                var victimName = victim is null
                    ? null
                    : await db.Users.AsNoTracking().Where(u => u.Id == victim).Select(u => u.Name).FirstOrDefaultAsync(ct);

                await auditLog.WriteHostAsync(
                    victim, victimName, "auth.refresh_reuse_detected",
                    AuditLogAppService.Modules.Authentication, AuditLogAppService.Categories.Auth,
                    entityType: "User", entityId: victim?.ToString(), entityLabel: victimName,
                    details: $"A refresh token that had already been rotated was presented again. Every active session for this account was revoked as a precaution ({rotated.SessionsRevoked} ended).",
                    sourceIp: clientIp, userAgent: userAgent, result: "Failure",
                    failureReason: "Refresh token reuse detected", authMethod: "Local", ct: ct);
            }

            throw new InvalidRefreshTokenException();
        }

        var user = rotated.User!;
        var newToken = rotated.NewToken!;
        if (user.Status != UserStatus.Active)
        {
            throw new AccountInactiveException();
        }

        var permissions = await permissionClaimsBuilder.BuildAsync(user, ct);
        var access = jwtTokenService.CreateAccessToken(user, permissions);

        return new AuthResult(
            access.Token,
            access.ExpiresAt,
            newToken.RawToken,
            newToken.ExpiresAt,
            ToCurrentUserDto(user, permissions));
    }

    /// <summary>
    /// Changes the authenticated caller's own password.
    ///
    /// Security properties, each deliberate:
    ///  - The account is identified by <paramref name="userId"/>, taken from the caller's validated
    ///    token by the controller. There is no user id in the request body, so this cannot be aimed
    ///    at another account.
    ///  - The current password is verified first, so a stolen access token alone is not enough to
    ///    take permanent ownership of an account.
    ///  - Google-provisioned accounts are refused: they have no local password, and silently
    ///    creating one would produce a second, weaker way into an SSO-governed account.
    ///  - Every OTHER session is revoked on success. Without that, a user changing their password
    ///    because they suspect compromise leaves the attacker signed in indefinitely — the stolen
    ///    refresh token would keep rotating itself.
    ///  - MustChangePassword is cleared, which is what makes this endpoint usable to satisfy a
    ///    forced first-login rotation.
    /// </summary>
    public async Task<ChangePasswordResponse> ChangePasswordAsync(
        Guid userId,
        string currentPassword,
        string newPassword,
        string? currentRawRefreshToken,
        string? clientIp,
        string? userAgent,
        CancellationToken ct = default)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);

        // The token authenticated, so the row should exist; if it doesn't (deleted mid-session) treat
        // it as a rejection rather than a 500.
        if (user is null || user.IsDeleted)
        {
            throw new PasswordChangeRejectedException("This account is no longer available.");
        }

        if (user.AuthProvider != AuthProvider.Local || user.PasswordHash is null)
        {
            throw new PasswordChangeRejectedException(
                "This account signs in with Google, so it has no OmniConnect password to change.");
        }

        if (!passwordHasher.Verify(user, user.PasswordHash, currentPassword))
        {
            // Audited: repeated failures here are a signal that someone is using a hijacked access
            // token and guessing at the password to make their access permanent.
            await auditLog.WriteHostAsync(
                user.Id, user.Name, "auth.password_change_failed",
                AuditLogAppService.Modules.Authentication, AuditLogAppService.Categories.Auth,
                entityType: "User", entityId: user.Id.ToString(), details: "Current password did not match.",
                entityLabel: user.Email, sourceIp: clientIp, result: "Failure",
                authMethod: "Local", userAgent: userAgent, ct: ct);

            throw new PasswordChangeRejectedException("Your current password is incorrect.");
        }

        var policyProblem = _passwordPolicy.Validate(newPassword);
        if (policyProblem is not null)
        {
            throw new PasswordChangeRejectedException(policyProblem);
        }

        if (_passwordPolicy.RejectSameAsCurrent && passwordHasher.Verify(user, user.PasswordHash, newPassword))
        {
            throw new PasswordChangeRejectedException("The new password must be different from your current one.");
        }

        user.PasswordHash = passwordHasher.Hash(user, newPassword);
        user.MustChangePassword = false;
        user.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);

        var sessionsEnded = await refreshTokenService.RevokeAllForUserExceptAsync(user.Id, currentRawRefreshToken, ct);

        await auditLog.WriteHostAsync(
            user.Id, user.Name, "auth.password_changed",
            AuditLogAppService.Modules.Authentication, AuditLogAppService.Categories.Auth,
            entityType: "User", entityId: user.Id.ToString(),
            details: sessionsEnded > 0
                ? $"Password changed. {sessionsEnded} other session(s) signed out."
                : "Password changed.",
            entityLabel: user.Email, sourceIp: clientIp, authMethod: "Local", userAgent: userAgent, ct: ct);

        return new ChangePasswordResponse(
            sessionsEnded > 0
                ? $"Password updated. {sessionsEnded} other session(s) were signed out."
                : "Password updated.",
            sessionsEnded);
    }

    /// <summary>
    /// Ends the session the presented refresh token belongs to.
    /// </summary>
    /// <remarks>
    /// Audited, which it was not before. A sign-in was recorded and a sign-out was not, so the trail
    /// could show an account signing in five times and never leaving — sessions appeared to
    /// accumulate indefinitely, and "was this person still working at 21:40?" had no answer. It also
    /// makes the reuse-detection event above interpretable: a rotation refused shortly after a
    /// deliberate sign-out reads very differently from one with no sign-out before it.
    ///
    /// The token is resolved to its owner BEFORE revocation, because afterwards the only link from
    /// the cookie to an account is the row being revoked.
    /// </remarks>
    public async Task LogoutAsync(string rawRefreshToken, string? clientIp = null, string? userAgent = null, CancellationToken ct = default)
    {
        var owner = await refreshTokenService.FindOwnerAsync(rawRefreshToken, ct);

        await refreshTokenService.RevokeAsync(rawRefreshToken, ct);

        // An unrecognised cookie is not an event worth a row — it is a stale browser, and recording
        // one would let anyone fill the trail by posting junk to an anonymous endpoint.
        if (owner is null)
        {
            return;
        }

        await auditLog.WriteHostAsync(
            owner.Value.UserId, owner.Value.Name, "auth.logout",
            AuditLogAppService.Modules.Authentication, AuditLogAppService.Categories.Auth,
            entityType: "User", entityId: owner.Value.UserId.ToString(), entityLabel: owner.Value.Name,
            details: "Signed out.", sourceIp: clientIp, userAgent: userAgent, ct: ct);
    }

    public async Task<CurrentUserDto?> GetCurrentUserAsync(Guid userId, CancellationToken ct = default)
    {
        // Read-only path (GET /api/auth/me) — no need for change tracking.
        var user = await db.Users.AsNoTracking().Include(u => u.Role).FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null)
        {
            return null;
        }

        var permissions = await permissionClaimsBuilder.BuildAsync(user, ct);
        return ToCurrentUserDto(user, permissions);
    }

    private async Task<AuthResult> IssueSessionAsync(User user, string? clientIp, CancellationToken ct)
    {
        var permissions = await permissionClaimsBuilder.BuildAsync(user, ct);
        var access = jwtTokenService.CreateAccessToken(user, permissions);
        // Named `ct:` deliberately — IssueAsync gained an optional `parent` parameter before the
        // cancellation token, so a positional call here would silently bind `ct` to `parent`.
        // This is a fresh sign-in, so there is no parent: a new session deadline starts now.
        var refresh = await refreshTokenService.IssueAsync(user.Id, clientIp, ct: ct);

        return new AuthResult(
            access.Token,
            access.ExpiresAt,
            refresh.RawToken,
            refresh.ExpiresAt,
            ToCurrentUserDto(user, permissions));
    }

    private static CurrentUserDto ToCurrentUserDto(User user, PermissionClaimsResult permissions) => new(
        user.Id,
        user.Salutation,
        user.Name,
        user.Email,
        user.PhoneNumber,
        user.RoleId,
        user.Role?.Name,
        permissions.IsAdministrator,
        user.MustChangePassword,
        permissions.Permissions,
        user.AuthProvider.ToString(),
        user.Status == UserStatus.Active,
        user.LastLoginAt);
}
