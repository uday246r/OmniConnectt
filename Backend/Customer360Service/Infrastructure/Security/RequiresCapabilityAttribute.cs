using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace backend.Infrastructure.Security;

/// <summary>
/// Server-side capability enforcement and dynamic permission discovery source for Customer360Service.
/// Reads the cached `perms` claim in the RS256 JWT without network round-trips.
/// Conforms with OmniRemit Host, EmployeeService, and LeadService security standards.
/// </summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class, AllowMultiple = true)]
public class RequiresCapabilityAttribute : Attribute, IAsyncAuthorizationFilter
{
    /// <summary>
    /// Root PermissionFeatureKey when registered in ModuleRegistry with Key = "customer360".
    /// </summary>
    public const string FeatureKey = "remote.customer360";

    public string Module { get; }
    public string Capability { get; }

    public RequiresCapabilityAttribute(string module, string capability)
    {
        Module = module;
        Capability = capability;
    }

    /// <summary>
    /// The permission string this attribute enforces: e.g. "remote.customer360.profile:View", "remote.customer360.products:View".
    /// </summary>
    public string RequiredPermission => $"{FeatureKey}.{Module.ToLowerInvariant()}:{Capability}";

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
        //
        // Asking about the submodule alone is enough: the gate walks ancestors, so an unlicensed
        // remote.customer360 blocks remote.customer360.profile without the app key being passed
        // separately. A submodule holding its own row wins over its parent, which is how one page can
        // be sold apart from the module containing it.
        var gate = context.HttpContext.RequestServices.GetRequiredService<EntitlementGate>();
        var submoduleKey = $"{FeatureKey}.{Module.ToLowerInvariant()}";
        var (allowed, lockReason) = await gate.IsAllowedAsync(submoduleKey, context.HttpContext.RequestAborted);
        if (!allowed)
        {
            context.Result = NotEntitled(submoduleKey, lockReason);
            return;
        }

        /*
         * Administrator bypass — ONE claim, checked exactly, matching EmployeeService, AuthService and
         * ModuleRegistry.
         *
         * This previously accepted claim aliases, ANY claim whose type merely *contains* "role" with a
         * value of Admin/SuperAdmin/Administrator, and user.IsInRole(...). That made a full
         * authorization bypass available to anyone who could get a role-shaped claim into a token,
         * while the same token was correctly refused by the three services that check only
         * `administrator == "true"`. Authorization must not vary by service, and must not depend on a
         * claim shape the platform never issues: AuthService's PermissionClaimsBuilder emits exactly
         * one administrator signal, JwtClaimTypes.Administrator.
         */
        if (user.FindFirst(JwtClaimTypes.Administrator)?.Value == "true")
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
            permissions = [];
        }

        /*
         * EXACT match on the full "featureKey:Capability" string — nothing else.
         *
         * This check previously ended with two prefix clauses:
         *     p.StartsWith($"{FeatureKey}.") || p.StartsWith($"{FeatureKey}:")
         * Every permission this service can possibly grant begins with "remote.customer360." (see
         * RequiredPermission above), so those clauses collapsed the entire check into "does the caller
         * hold ANY permission in this app?". A user granted only `remote.customer360.profile:View`
         * therefore passed [RequiresCapability("fieldsettings","Manage")] on PUT /v1/field-config —
         * a read-only profile viewer could rewrite the field-masking configuration that decides which
         * customer data everyone else is allowed to see.
         *
         * The alternate-format clauses were dead weight: AuthService's PermissionClaimsBuilder emits
         * one and only one shape, $"{feature.Key}:{capability}", which is exactly what RequiredPermission
         * builds. The "*" and "{FeatureKey}:*" wildcards were unreachable — nothing in the platform ever
         * issues them — but would have been a total bypass if anything ever did.
         */
        var hasMatch = permissions.Any(p =>
            string.Equals(p, RequiredPermission, StringComparison.OrdinalIgnoreCase));

        if (!hasMatch)
        {
            context.Result = new ObjectResult(new ProblemDetails
            {
                Title = $"You don't have '{Capability}' access to {Module}.",
                Status = StatusCodes.Status403Forbidden,
                Detail = $"Required permission: {RequiredPermission}"
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
