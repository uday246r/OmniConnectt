using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace AuthService.Infrastructure.Security;

/// <summary>
/// Server-side enforcement mirroring the frontend's capability gate — the frontend hides buttons the
/// user can't use, this is what actually stops the request if someone calls the API directly. Reads
/// the "administrator"/"perms" claims embedded in the access token at login/refresh (see
/// JwtTokenService), so it never touches the database. Must be combined with [Authorize].
/// </summary>
/// <remarks>
/// Implemented as an <see cref="IAsyncAuthorizationFilter"/>, NOT an action filter.
///
/// As an action filter it ran after model binding, and [ApiController] registers its automatic
/// ModelState-invalid 400 as an action filter at Order = -2000 — so an unauthorized POST with a
/// malformed body answered 400 before this check ran. Verified live against all three services: a
/// token carrying an EMPTY permission list received 400 from POST /api/users, POST /api/roles and
/// POST /api/remote-apps, while GET /api/users correctly returned 403.
///
/// No unauthorized write completed (a well-formed payload still reached the check and was refused),
/// but authorization must not depend on payload validity: it let an unauthorized caller distinguish a
/// valid request shape from an invalid one, and it meant any action filter with a lower Order would
/// run for a request that was about to be refused. In the authorization stage the answer is 403
/// regardless of the body.
/// </remarks>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]
public class RequirePermissionAttribute(string featureKey, string capability) : Attribute, IAsyncAuthorizationFilter
{
    public Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var user = context.HttpContext.User;

        // Defence in depth: [Authorize] should have rejected an unauthenticated caller already, but
        // an anonymous principal carries no perms claim, which would otherwise look identical to an
        // authenticated user holding no permissions.
        if (user.Identity?.IsAuthenticated != true)
        {
            context.Result = new UnauthorizedResult();
            return Task.CompletedTask;
        }

        var isAdministrator = user.FindFirst(JwtTokenService.AdministratorClaimType)?.Value == "true";
        if (isAdministrator)
        {
            return Task.CompletedTask;
        }

        string[] permissions;
        try
        {
            var permsClaim = user.FindFirst(JwtTokenService.PermissionsClaimType)?.Value;
            permissions = string.IsNullOrEmpty(permsClaim)
                ? []
                : JsonSerializer.Deserialize<string[]>(permsClaim) ?? [];
        }
        catch (JsonException)
        {
            // Fail closed. An unparseable claim must mean "no permissions", never "all permissions",
            // and letting the exception escape would surface as a 500 rather than a refusal.
            permissions = [];
        }

        var required = $"{featureKey}:{capability}";
        if (!permissions.Contains(required))
        {
            context.Result = new ObjectResult(new ProblemDetails
            {
                Title = $"You don't have '{capability}' access to '{featureKey}'.",
                Status = StatusCodes.Status403Forbidden,
            })
            { StatusCode = StatusCodes.Status403Forbidden };
        }

        return Task.CompletedTask;
    }
}
