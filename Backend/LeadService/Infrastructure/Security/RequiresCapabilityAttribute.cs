using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace LeadManagement.Api.Infrastructure.Security;

/// <summary>
/// Server-side capability enforcement and dynamic permission discovery source for LeadService.
/// Reads the cached `perms` claim in the RS256 JWT without network round-trips.
/// Follows the exact standard established by EmployeeService and AuthService.
/// </summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class, AllowMultiple = true)]
public class RequiresCapabilityAttribute : Attribute, IAsyncAuthorizationFilter
{
    /// <summary>
    /// Root PermissionFeatureKey when registered under Setup > Applications with Key = "lead".
    /// </summary>
    public const string FeatureKey = "remote.lead";

    public string Module { get; }
    public string Capability { get; }

    public RequiresCapabilityAttribute(string module, string capability)
    {
        Module = module;
        Capability = capability;
    }

    /// <summary>
    /// The permission string this attribute enforces: e.g. "remote.lead.lead:View", "remote.lead.dashboard:View".
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
         * This previously also accepted `admin`/`isAdministrator` claim aliases and, worse,
         * `user.IsInRole("Admin"|"SuperAdmin"|"Administrator")`. IsInRole matches any claim whose type
         * is the token's role-claim type, so anyone who could get a role-shaped claim named "Admin"
         * into a token received a full authorization bypass here — while the same token was correctly
         * refused by the three services that check only `administrator == "true"`. Authorization must
         * not vary by service, and it must not depend on a claim the platform never issues:
         * PermissionClaimsBuilder emits exactly one administrator signal, JwtClaimTypes.Administrator.
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
         * Every permission this service can possibly grant begins with "remote.lead." (see
         * RequiredPermission above), so those clauses collapsed the entire check into "does the caller
         * hold ANY permission in this app?". A user granted only `remote.lead.lead:View` therefore
         * passed [RequiresCapability("Lead","Delete")] and [RequiresCapability("FieldSettings","Manage")]
         * — a read-only viewer could delete leads and rewrite the product field configuration.
         *
         * The alternate-format string.Equals clauses that preceded them were dead weight: AuthService's
         * PermissionClaimsBuilder emits one and only one shape, $"{feature.Key}:{capability}", which is
         * exactly what RequiredPermission builds. The "*" and "{FeatureKey}:*" wildcards were likewise
         * unreachable — nothing in the platform ever issues them — but would have been a total bypass
         * if anything ever did.
         *
         * Case-insensitive because capability casing is authored by hand in [RequiresCapability(...)]
         * attributes and stored separately in the DB; it is still a full-string match, so it grants
         * nothing the exact-match comparison in EmployeeService/AuthService wouldn't.
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
