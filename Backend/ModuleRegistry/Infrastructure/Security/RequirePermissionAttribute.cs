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
    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var user = context.HttpContext.User;

        if (user.Identity?.IsAuthenticated != true)
        {
            context.Result = new UnauthorizedResult();
            return;
        }

        // Licensing, checked BEFORE the administrator bypass below.
        //
        // Permission and entitlement answer different questions: a Super Admin is the most privileged
        // USER, which says nothing about whether the deployment bought this module. A licence a Super
        // Admin can switch off by being a Super Admin is not a licence.
        var gate = context.HttpContext.RequestServices.GetRequiredService<EntitlementGate>();
        var (allowed, lockReason) = await gate.IsAllowedAsync(featureKey, context.HttpContext.RequestAborted);
        if (!allowed)
        {
            context.Result = NotEntitled(featureKey, lockReason);
            return;
        }

        var isAdministrator = user.FindFirst(JwtClaimTypes.Administrator)?.Value == "true";
        if (isAdministrator)
        {
            return;
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
        if (!permissions.Contains(required))
        {
            context.Result = new ObjectResult(new ProblemDetails
            {
                Title = $"You don't have '{capability}' access to '{featureKey}'.",
                Status = StatusCodes.Status403Forbidden,
            })
            { StatusCode = StatusCodes.Status403Forbidden };
        }
    }

    /// <summary>
    /// The refusal for an unlicensed module. A distinct problem <c>type</c> is what lets the host tell
    /// "your plan does not include this" from "your role does not allow this" and render an upsell
    /// rather than a permission error — on the wire the two are otherwise identical.
    /// </summary>
    private static ObjectResult NotEntitled(string featureKey, string? lockReason)
    {
        var problem = new ProblemDetails
        {
            Title = "This module is not included in your plan.",
            Type = "https://omniremit.dev/errors/not-entitled",
            Status = StatusCodes.Status403Forbidden,
        };
        problem.Extensions["featureKey"] = featureKey;
        problem.Extensions["reason"] = lockReason;

        return new ObjectResult(problem) { StatusCode = StatusCodes.Status403Forbidden };
    }
}
