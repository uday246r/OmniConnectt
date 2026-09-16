using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace LeadManagement.Api.Infrastructure.Security;

/// <summary>
/// Passes when the caller holds ANY one of several capabilities, each written "Module:Capability".
/// </summary>
/// <remarks>
/// <para>
/// For reads more than one role legitimately needs. The field configuration is the case that forced
/// it: it was readable only with Field Settings access, but the Create and Edit Lead forms and the
/// lead details view depend on it — which fields to show, which are required, which are sensitive and
/// how to mask them. A lead maker without Field Settings access got a 403 the form swallowed, so every
/// field was optional and sensitive values were shown unmasked.
/// </para>
/// <para>
/// Each alternative is an exact permission match, as <see cref="RequiresCapabilityAttribute"/> is, and
/// PermissionsController publishes each alternative's capability like any other.
/// </para>
/// </remarks>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class, AllowMultiple = false)]
public sealed class RequiresAnyCapabilityAttribute : Attribute, IAsyncAuthorizationFilter
{
    public IReadOnlyList<(string Module, string Capability)> Alternatives { get; }

    public RequiresAnyCapabilityAttribute(params string[] alternatives)
    {
        Alternatives = alternatives
            .Select(a => a.Split(':', 2))
            .Select(parts => parts.Length == 2
                ? (parts[0], parts[1])
                : throw new ArgumentException($"'{string.Join(':', parts)}' is not in Module:Capability form."))
            .ToList();
    }

    public static string PermissionFor(string module, string capability) =>
        $"{RequiresCapabilityAttribute.FeatureKey}.{module.ToLowerInvariant()}:{capability}";

    public Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var user = context.HttpContext.User;
        if (user.Identity?.IsAuthenticated != true)
        {
            context.Result = new UnauthorizedResult();
            return Task.CompletedTask;
        }

        if (user.FindFirst(JwtClaimTypes.Administrator)?.Value == "true")
        {
            return Task.CompletedTask;
        }

        string[] permissions;
        try
        {
            var claim = user.FindFirst(JwtClaimTypes.Permissions)?.Value;
            permissions = string.IsNullOrEmpty(claim) ? [] : JsonSerializer.Deserialize<string[]>(claim) ?? [];
        }
        catch (JsonException)
        {
            permissions = [];
        }

        var granted = Alternatives.Any(a =>
            permissions.Contains(PermissionFor(a.Module, a.Capability), StringComparer.OrdinalIgnoreCase));

        if (!granted)
        {
            context.Result = new ObjectResult(new ProblemDetails
            {
                Title = "You don't have access to this.",
                Status = StatusCodes.Status403Forbidden,
                Detail = "Requires one of: " + string.Join(", ", Alternatives.Select(a => PermissionFor(a.Module, a.Capability))),
            })
            { StatusCode = StatusCodes.Status403Forbidden };
        }

        return Task.CompletedTask;
    }
}
