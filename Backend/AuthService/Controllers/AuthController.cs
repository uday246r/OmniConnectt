using System.Security.Claims;
using AuthService.Application.Services;
using AuthService.Application.DTOs;
using AuthService.Infrastructure.Security;
using AuthService.Options;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace AuthService.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(
    AuthAppService authAppService,
    IOptions<AuthCookieOptions> cookieOptions,
    PasswordPolicyAppService passwordPolicy,
    SetPasswordInviteService invites,
    PasswordResetService passwordReset,
    IWebHostEnvironment env) : ControllerBase
{
    private readonly AuthCookieOptions _cookieOptions = cookieOptions.Value;

    [HttpPost("login")]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [AllowAnonymous]
    public async Task<ActionResult<LoginResponse>> Login([FromBody] LoginRequest request, CancellationToken ct)
    {
        try
        {
            var result = await authAppService.LoginAsync(request.Email, request.Password, ClientIp(), UserAgent(), ct);
            SetRefreshCookie(result.RefreshToken, result.RefreshExpiresAt);
            return Ok(new LoginResponse(result.AccessToken, result.ExpiresAt, result.User));
        }
        catch (InvalidCredentialsException)
        {
            return Unauthorized(new ProblemDetails { Title = "Invalid email or password.", Status = 401 });
        }
        catch (AccountInactiveException ex)
        {
            return StatusCode(403, new ProblemDetails { Title = ex.Message, Status = 403 });
        }
    }

    [HttpPost("google")]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [AllowAnonymous]
    public async Task<ActionResult<LoginResponse>> GoogleLogin([FromBody] GoogleLoginRequest request, CancellationToken ct)
    {
        try
        {
            var result = await authAppService.GoogleLoginAsync(request.IdToken, ClientIp(), UserAgent(), ct);
            SetRefreshCookie(result.RefreshToken, result.RefreshExpiresAt);
            return Ok(new LoginResponse(result.AccessToken, result.ExpiresAt, result.User));
        }
        catch (SsoNotConfiguredException ex)
        {
            return StatusCode(503, new ProblemDetails { Title = ex.Message, Status = 503 });
        }
        catch (SsoDomainNotAllowedException ex)
        {
            return Unauthorized(new ProblemDetails { Title = ex.Message, Status = 401 });
        }
        catch (SsoAccountNotFoundException ex)
        {
            return Unauthorized(new ProblemDetails { Title = ex.Message, Status = 401 });
        }
        catch (InvalidCredentialsException)
        {
            return Unauthorized(new ProblemDetails { Title = "Invalid or expired Google sign-in. Please try again.", Status = 401 });
        }
        catch (AccountInactiveException ex)
        {
            return StatusCode(403, new ProblemDetails { Title = ex.Message, Status = 403 });
        }
    }

    /// <summary>Public, non-secret — lets the frontend know whether to show "Sign in with Google" and which domains it accepts, instead of hardcoding either.</summary>
    [HttpGet("sso-config")]
    [AllowAnonymous]
    public ActionResult<SsoConfigDto> SsoConfig() => Ok(authAppService.GetSsoConfig());

    /*
     * Set-password invites.
     *
     * Both endpoints are necessarily anonymous — the whole point is that the recipient has no
     * credentials yet — so both are rate limited under the authentication policy alongside login,
     * which is what makes brute-forcing the 256-bit token impractical as well as pointless.
     *
     * Neither endpoint ever distinguishes "no such token" from "expired" from "already used". They
     * are all one message, because telling an anonymous caller which of those applies would confirm
     * that a particular token once existed.
     */

    /// <summary>Checks a link before the user types anything, so an expired invite says so up front rather than after.</summary>
    [HttpGet("set-password/validate")]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [AllowAnonymous]
    public async Task<ActionResult<ValidateInviteResponse>> ValidateInvite([FromQuery] string token, CancellationToken ct)
    {
        var invite = await invites.FindRedeemableAsync(token, ct);
        return invite?.User is null
            ? Ok(new ValidateInviteResponse(false, null))
            // The email address is echoed back only for a VALID token — the caller demonstrably
            // already has the invite, so showing which account it belongs to reveals nothing new and
            // prevents someone setting a password on an account they did not expect.
            : Ok(new ValidateInviteResponse(true, invite.User.Email));
    }

    [HttpPost("set-password")]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [AllowAnonymous]
    public async Task<IActionResult> SetPassword([FromBody] SetPasswordRequest request, CancellationToken ct)
    {
        var problem = await invites.RedeemAsync(request.Token, request.NewPassword, ct);
        return problem is null
            ? NoContent()
            : BadRequest(new ProblemDetails { Title = problem, Status = 400 });
    }

    /*
     * "Forgot password?"
     *
     * All three endpoints are necessarily anonymous, for the same reason the set-password ones above
     * are: whoever is using them has, by definition, no working session. Rate limited under the same
     * authentication policy as login for the same reason too — a 256-bit token is only impractical to
     * brute-force if the caller cannot make unlimited attempts.
     *
     * ForgotPassword never reveals whether the address matched an account — see PasswordResetService
     * for why — so its response is identical for a real account, an unknown address, a Google account,
     * and an inactive one. The other two behave exactly like their set-password counterparts: neither
     * distinguishes "no such token" from "expired" from "already used".
     */

    /// <summary>
    /// Starts a password reset. Always answers the same way regardless of whether the address exists,
    /// so this endpoint cannot be used to discover which email addresses have accounts — see
    /// <see cref="PasswordResetService.RequestResetAsync"/> for what actually happens behind that.
    /// </summary>
    [HttpPost("forgot-password")]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [AllowAnonymous]
    public async Task<IActionResult> ForgotPassword([FromBody] ForgotPasswordRequest request, CancellationToken ct)
    {
        await passwordReset.RequestResetAsync(request.Email, ClientIp(), UserAgent(), ct);
        return Ok(new { message = "If an account exists for that email address, a password reset link has been sent to it." });
    }

    /// <summary>Checks a link before the user types anything, so an expired link says so up front rather than after.</summary>
    [HttpGet("reset-password/validate")]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [AllowAnonymous]
    public async Task<ActionResult<ValidateResetTokenResponse>> ValidateResetToken([FromQuery] string token, CancellationToken ct)
    {
        var resetToken = await passwordReset.FindRedeemableAsync(token, ct);
        return resetToken?.User is null
            ? Ok(new ValidateResetTokenResponse(false, null))
            // Echoed back only for a VALID token — the caller already demonstrably holds the link.
            : Ok(new ValidateResetTokenResponse(true, resetToken.User.Email));
    }

    [HttpPost("reset-password")]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [AllowAnonymous]
    public async Task<IActionResult> ResetPassword([FromBody] ResetPasswordRequest request, CancellationToken ct)
    {
        var problem = await passwordReset.RedeemAsync(request.Token, request.NewPassword, ct);
        return problem is null
            ? NoContent()
            : BadRequest(new ProblemDetails { Title = problem, Status = 400 });
    }

    [HttpPost("refresh")]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [AllowAnonymous]
    [AllowWhenPasswordChangeRequired]
    public async Task<ActionResult<RefreshResponse>> Refresh(CancellationToken ct)
    {
        var rawToken = Request.Cookies[_cookieOptions.RefreshCookieName];
        if (string.IsNullOrEmpty(rawToken))
        {
            return Unauthorized(new ProblemDetails { Title = "No refresh session present.", Status = 401 });
        }

        try
        {
            var result = await authAppService.RefreshAsync(rawToken, ClientIp(), UserAgent(), ct);
            SetRefreshCookie(result.RefreshToken, result.RefreshExpiresAt);
            return Ok(new RefreshResponse(result.AccessToken, result.ExpiresAt, result.User));
        }
        catch (InvalidRefreshTokenException)
        {
            ClearRefreshCookie();
            return Unauthorized(new ProblemDetails { Title = "Refresh session is invalid or has expired.", Status = 401 });
        }
        catch (AccountInactiveException ex)
        {
            ClearRefreshCookie();
            return StatusCode(403, new ProblemDetails { Title = ex.Message, Status = 403 });
        }
    }

    [HttpPost("logout")]
    [AllowAnonymous]
    [AllowWhenPasswordChangeRequired]
    public async Task<IActionResult> Logout(CancellationToken ct)
    {
        var rawToken = Request.Cookies[_cookieOptions.RefreshCookieName];
        if (!string.IsNullOrEmpty(rawToken))
        {
            await authAppService.LogoutAsync(rawToken, ClientIp(), UserAgent(), ct);
        }

        ClearRefreshCookie();
        return NoContent();
    }

    /// <summary>
    /// The password rules actually enforced by this deployment, so the UI can display them instead of
    /// hardcoding its own copy. The frontend previously told users "at least 6 characters" while the
    /// server required twelve — the form accepted input the server then rejected.
    ///
    /// Non-secret (it describes a validation rule, not a credential) but authenticated, since only
    /// signed-in users have any use for it.
    /// </summary>
    [HttpGet("password-policy")]
    [Authorize]
    [AllowWhenPasswordChangeRequired]
    public async Task<ActionResult<PasswordPolicyDto>> PasswordPolicy(CancellationToken ct)
    {
        // Read from the database on every call, so an administrator's edit is what the change-password
        // form's live requirement checklist shows on its next load.
        var rules = await passwordPolicy.GetComplexityAsync(ct);
        return Ok(new PasswordPolicyDto(
            rules.MinimumLength,
            rules.MaximumLength,
            rules.RequireUppercase,
            rules.RequireLowercase,
            rules.RequireDigit,
            rules.RequireNonAlphanumeric,
            rules.Describe()));
    }

    /// <summary>
    /// Changes the caller's OWN password. The account is taken from the validated token, never from
    /// the body — there is deliberately no userId parameter here. An administrator resetting someone
    /// else's password is a separate, permission-gated operation on UsersController.
    /// </summary>
    [HttpPost("change-password")]
    [Authorize]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    [AllowWhenPasswordChangeRequired]
    public async Task<ActionResult<ChangePasswordResponse>> ChangePassword(
        [FromBody] ChangePasswordRequest request, CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
        if (!Guid.TryParse(userId, out var id))
        {
            return Unauthorized();
        }

        try
        {
            // The caller's own refresh token is passed so their current session survives while every
            // other session for the account is revoked.
            var result = await authAppService.ChangePasswordAsync(
                id,
                request.CurrentPassword,
                request.NewPassword,
                Request.Cookies[_cookieOptions.RefreshCookieName],
                HttpContext.Connection.RemoteIpAddress?.ToString(),
                Request.Headers.UserAgent.ToString(),
                ct);

            return Ok(result);
        }
        catch (PasswordChangeRejectedException ex)
        {
            // 400, not 401. A 401 would trip the frontend's refresh-and-retry interceptor, which
            // would then sign the user out for mistyping their current password.
            return BadRequest(new ProblemDetails { Title = ex.Message, Status = 400 });
        }
    }

    [HttpGet("me")]
    [Authorize]
    [AllowWhenPasswordChangeRequired]
    public async Task<ActionResult<CurrentUserDto>> Me(CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
        if (!Guid.TryParse(userId, out var id))
        {
            return Unauthorized();
        }

        var current = await authAppService.GetCurrentUserAsync(id, ct);
        return current is null ? Unauthorized() : Ok(current);
    }

    private void SetRefreshCookie(string rawToken, DateTimeOffset expiresAt)
    {
        var sameSite = _cookieOptions.SameSite.Trim() switch
        {
            var s when string.Equals(s, "None", StringComparison.OrdinalIgnoreCase) => SameSiteMode.None,
            var s when string.Equals(s, "Strict", StringComparison.OrdinalIgnoreCase) => SameSiteMode.Strict,
            _ => SameSiteMode.Lax,
        };

        // SameSite=None is only honoured on a Secure cookie — every current browser drops it
        // outright otherwise. Silently issuing a cookie the browser discards would look exactly like
        // a working login that loses its session on the next refresh, so fail loudly at the point of
        // misconfiguration instead.
        var secure = !env.IsDevelopment();
        if (sameSite == SameSiteMode.None && !secure)
        {
            throw new InvalidOperationException(
                "Auth__SameSite=None requires a Secure cookie, which is not issued in the Development " +
                "environment. Use Lax locally, or run with ASPNETCORE_ENVIRONMENT=Production behind HTTPS.");
        }

        var options = new CookieOptions
        {
            HttpOnly = true,
            Secure = secure,
            SameSite = sameSite,
            Expires = expiresAt,
            Path = "/api/auth",
        };

        if (!string.IsNullOrWhiteSpace(_cookieOptions.RefreshCookieDomain))
        {
            options.Domain = _cookieOptions.RefreshCookieDomain;
        }

        Response.Cookies.Append(_cookieOptions.RefreshCookieName, rawToken, options);
    }

    /// <summary>
    /// Deletion must repeat the attributes the cookie was WRITTEN with. A browser matches a deletion
    /// against name + path + domain, so clearing with a bare Path while the cookie was issued with a
    /// Domain leaves the original in place — logout would appear to succeed while the refresh token
    /// stayed valid in the browser. Secure/SameSite are mirrored for the same reason: a SameSite=None
    /// deletion sent without Secure is itself rejected.
    /// </summary>
    private void ClearRefreshCookie()
    {
        var options = new CookieOptions
        {
            Path = "/api/auth",
            Secure = !env.IsDevelopment(),
            SameSite = _cookieOptions.SameSite.Trim() switch
            {
                var s when string.Equals(s, "None", StringComparison.OrdinalIgnoreCase) => SameSiteMode.None,
                var s when string.Equals(s, "Strict", StringComparison.OrdinalIgnoreCase) => SameSiteMode.Strict,
                _ => SameSiteMode.Lax,
            },
        };

        if (!string.IsNullOrWhiteSpace(_cookieOptions.RefreshCookieDomain))
        {
            options.Domain = _cookieOptions.RefreshCookieDomain;
        }

        Response.Cookies.Delete(_cookieOptions.RefreshCookieName, options);
    }

    private string? ClientIp() => HttpContext.Connection.RemoteIpAddress?.ToString();

    private string? UserAgent() => Request.Headers.UserAgent.ToString() is { Length: > 0 } ua ? ua : null;
}
