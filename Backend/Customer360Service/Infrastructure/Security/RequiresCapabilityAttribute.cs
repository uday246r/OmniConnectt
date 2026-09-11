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
    /// Root PermissionFeatureKey when registered under Setup > Applications with Key = "customer360".
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

    public Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var user = context.HttpContext.User;

        if (user.Identity?.IsAuthenticated != true)
        {
            context.Result = new UnauthorizedResult();
            return Task.CompletedTask;
        }

        /*
         * Administrator bypass — ONE claim, checked exactly, matching AuthService.
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

        return Task.CompletedTask;
    }
}
