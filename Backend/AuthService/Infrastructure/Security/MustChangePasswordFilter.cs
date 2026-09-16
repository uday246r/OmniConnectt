using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace AuthService.Infrastructure.Security;

/// <summary>
/// Turns User.MustChangePassword from an advisory flag into real enforcement: a caller whose token
/// carries mustChangePassword=true is refused by every AuthService endpoint except the handful
/// marked [AllowWhenPasswordChangeRequired] — change-password, refresh, logout, me, password-policy.
/// Registered globally in Program.cs, so a new controller is covered by default and has to opt out
/// explicitly rather than remember to opt in.
/// </summary>
/// <remarks>
/// An <see cref="IAsyncAuthorizationFilter"/>, NOT an action filter — the same lesson already
/// documented on RequirePermissionAttribute and InternalApiKeyFilter. As an action filter this would
/// run after model binding, and [ApiController]'s automatic ModelState-invalid 400 runs before it, so
/// a blocked user POSTing a malformed body would receive 400 instead of 403.
///
/// Registered globally, it runs ahead of any controller/action-scoped authorization filter of the
/// same relative order (global-scope filters run first), so it fires before [RequirePermission] — a
/// blocked user sees one consistent "change your password" refusal rather than a permission error
/// that varies by whichever endpoint they happened to hit.
/// </remarks>
public class MustChangePasswordFilter : IAsyncAuthorizationFilter
{
    /// <summary>Surfaced in ProblemDetails.Type so the frontend can recognise this specific refusal
    /// without string-matching a human-readable title.</summary>
    public const string ProblemType = "urn:omniconnect:password-change-required";

    public Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var user = context.HttpContext.User;

        // Anonymous endpoints (login, google, sso-config, health) carry no principal — nothing to
        // enforce, nothing to break.
        if (user.Identity?.IsAuthenticated != true)
        {
            return Task.CompletedTask;
        }

        if (user.FindFirst(JwtTokenService.MustChangePasswordClaimType)?.Value != "true")
        {
            return Task.CompletedTask;
        }

        // EndpointMetadata carries attributes from both the action and its controller.
        if (context.ActionDescriptor.EndpointMetadata.OfType<AllowWhenPasswordChangeRequiredAttribute>().Any())
        {
            return Task.CompletedTask;
        }

        context.Result = new ObjectResult(new ProblemDetails
        {
            Title = "You must set your own password before using OmniConnect.",
            Detail = "This account is still using a temporary password issued by an administrator.",
            Type = ProblemType,
            Status = StatusCodes.Status403Forbidden,
        })
        { StatusCode = StatusCodes.Status403Forbidden };

        return Task.CompletedTask;
    }
}
