using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace ModuleRegistry.Infrastructure.Security;

/// <summary>
/// Server-side enforcement for the admin RemoteApps CRUD surface — see AuthService's identical
/// attribute for the full rationale. Must be combined with [Authorize].
/// </summary>
/// <remarks>
/// An <see cref="IAsyncAuthorizationFilter"/>, not an action filter: as an action filter it ran after
/// model binding, so [ApiController]'s automatic ModelState 400 (registered at Order = -2000)
/// answered first. Verified live — a token with an empty permission list got 400 from
/// POST /api/remote-apps instead of 403.
/// </remarks>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]
public class RequirePermissionAttribute(string featureKey, string capability) : Attribute, IAsyncAuthorizationFilter
{
    public Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var user = context.HttpContext.User;

        if (user.Identity?.IsAuthenticated != true)
        {
            context.Result = new UnauthorizedResult();
            return Task.CompletedTask;
        }

        var isAdministrator = user.FindFirst(JwtClaimTypes.Administrator)?.Value == "true";
        if (isAdministrator)
        {
            return Task.CompletedTask;
        }

        string[] permissions;
        try
        {
            var permsClaim = user.FindFirst(JwtClaimTypes.Permissions)?.Value;
            permissions = string.IsNullOrEmpty(permsClaim)
                ? []
                : JsonSerializer.Deserialize<string[]>(permsClaim) ?? [];
        }
        catch (JsonException)
        {
            // Fail closed — an unparseable claim means no permissions, never all of them.
            permissions = [];
        }

        var required = $"{featureKey}:{capability}";
        /*
         * Case-insensitive, matching LeadService and Customer360Service.
         *
         * These two compared ordinally while the two remote services did not, so the same grant could
         * authorise in one service and be refused in another. Nothing exercised the difference —
         * PermissionClaimsBuilder emits one casing and the attributes are written to match — but a
         * capability key is hand-authored in two places, and an authorization answer that depends on
         * which service you happen to ask is a bug waiting for the first mismatched letter.
         *
         * Still a full-string comparison, so this grants nothing a differently-cased exact match
         * would not already have granted.
         */
        if (!permissions.Contains(required, StringComparer.OrdinalIgnoreCase))
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
