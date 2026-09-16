using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Options;
using ProductMarketplace.Api.Options;

namespace ProductMarketplace.Api.Infrastructure.Security;

/// <summary>
/// Refuses a request unless the caller's platform token grants <c>remote.{appKey}.{module}:{capability}</c>.
/// </summary>
/// <remarks>
/// <para>
/// The same contract every remote on the platform enforces (see LeadService's attribute of the same
/// name): the host issues the JWT, AuthService puts API capabilities in its <c>perms</c> claim, and this
/// reads that claim with no network call. The single administrator signal bypasses it.
/// </para>
/// <para>
/// This is also the discovery source. <c>GET /permissions</c> publishes exactly the capabilities these
/// attributes demand, so the Role editor can never offer a checkbox nothing enforces, and nothing is
/// enforced that the Role editor cannot grant.
/// </para>
/// <para>
/// The app key comes from <see cref="SelfOptions.AppKey"/> rather than a constant, so registering this
/// remote under a different key in Setup → Applications is a configuration change only.
/// </para>
/// </remarks>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class, AllowMultiple = true)]
public class RequiresCapabilityAttribute(string module, string capability) : Attribute, IAsyncAuthorizationFilter
{
    public string Module { get; } = module;
    public string Capability { get; } = capability;

    public Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var appKey = context.HttpContext.RequestServices.GetRequiredService<IOptions<SelfOptions>>().Value.AppKey;
        var outcome = PlatformPermissions.Evaluate(context.HttpContext.User, appKey, [(Module, Capability)]);
        if (outcome is not null)
        {
            context.Result = outcome;
        }

        return Task.CompletedTask;
    }
}

/// <summary>
/// Passes when the caller holds ANY of the listed <c>module:Capability</c> pairs.
/// </summary>
/// <remarks>
/// Multiple <see cref="RequiresCapabilityAttribute"/>s combine with AND. Reference data — product types,
/// document requirements, employment types, status values — is read by several screens owned by
/// different permissions: the Setup page manages it, while the product editor and the Apply form only
/// need to read it. Requiring <c>setup:View</c> for all of them would force every applicant to be a Setup
/// viewer; requiring nothing would expose the catalog to anyone with a token. Any-of says exactly
/// "someone working in this area".
/// </remarks>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class, AllowMultiple = true)]
public class RequiresAnyCapabilityAttribute(params string[] moduleCapabilities) : Attribute, IAsyncAuthorizationFilter
{
    public IReadOnlyList<(string Module, string Capability)> Alternatives { get; } = moduleCapabilities
        .Select(pair =>
        {
            var parts = pair.Split(':', 2);
            if (parts.Length != 2 || parts[0].Length == 0 || parts[1].Length == 0)
            {
                throw new ArgumentException($"'{pair}' is not a module:Capability pair.", nameof(moduleCapabilities));
            }

            return (parts[0], parts[1]);
        })
        .ToList();

    public Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var appKey = context.HttpContext.RequestServices.GetRequiredService<IOptions<SelfOptions>>().Value.AppKey;
        var outcome = PlatformPermissions.Evaluate(context.HttpContext.User, appKey, Alternatives);
        if (outcome is not null)
        {
            context.Result = outcome;
        }

        return Task.CompletedTask;
    }
}

/// <summary>The shared decision behind both capability attributes.</summary>
public static class PlatformPermissions
{
    /// <summary>The exact permission string AuthService issues for a module capability.</summary>
    public static string PermissionFor(string appKey, string module, string capability) =>
        $"remote.{appKey.ToLowerInvariant()}.{module.ToLowerInvariant()}:{capability}";

    /// <returns>Null when allowed; otherwise the 401/403 result to return.</returns>
    public static IActionResult? Evaluate(
        System.Security.Claims.ClaimsPrincipal user, string appKey, IReadOnlyList<(string Module, string Capability)> alternatives)
    {
        if (user.Identity?.IsAuthenticated != true)
        {
            return new UnauthorizedResult();
        }

        if (user.FindFirst(JwtClaimTypes.Administrator)?.Value == "true")
        {
            return null;
        }

        var held = ReadPermissions(user);
        foreach (var (module, capability) in alternatives)
        {
            var required = PermissionFor(appKey, module, capability);
            // Full-string comparison only — never a prefix. A prefix match turns "holds any permission
            // in this app" into "holds every permission in this app".
            if (held.Contains(required, StringComparer.OrdinalIgnoreCase))
            {
                return null;
            }
        }

        var first = alternatives[0];
        return new ObjectResult(new ProblemDetails
        {
            Title = alternatives.Count == 1
                ? $"You don't have '{first.Capability}' access to {first.Module}."
                : "You don't have access to this part of Products & Marketplace.",
            Status = StatusCodes.Status403Forbidden,
            Detail = "Required permission: " + string.Join(" or ", alternatives.Select(a => PermissionFor(appKey, a.Module, a.Capability))),
        })
        { StatusCode = StatusCodes.Status403Forbidden };
    }

    private static string[] ReadPermissions(System.Security.Claims.ClaimsPrincipal user)
    {
        var claim = user.FindFirst(JwtClaimTypes.Permissions)?.Value;
        if (string.IsNullOrEmpty(claim))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<string[]>(claim) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }
}
