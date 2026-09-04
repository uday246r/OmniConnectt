using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace LeadManagement.Api.Infrastructure.Security;

/// <summary>
/// Enforces a capability declared in <see cref="LeadCapabilityManifest"/> — one that guards a KPI,
/// a chart, an export or a panel rather than a whole endpoint.
/// </summary>
/// <remarks>
/// The counterpart to <see cref="RequiresCapabilityAttribute"/>. Same permission-string format, same
/// administrator bypass, same 403, same authorization stage — the only difference is that it resolves
/// from <see cref="FineCapabilityClient"/> instead of the <c>perms</c> claim, because these
/// capabilities are deliberately not in the token.
/// <para>
/// It exists so that hiding a widget is not the control. A dashboard that omits a card the user was
/// not granted, while the endpoint behind it still answers, has not withheld anything — it has only
/// made the data slightly less convenient to fetch.
/// </para>
/// <para>
/// The two attributes compose, and usually should: <c>[RequiresCapability("Dashboard","View")]</c>
/// says the caller may see the dashboard at all, and this says which parts of it. Both run in the
/// authorization stage, so either can refuse before the request is bound.
/// </para>
/// </remarks>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class, AllowMultiple = true)]
public class RequiresFineCapabilityAttribute(string module, string capability) : Attribute, IFilterFactory
{
    public string Module { get; } = module;
    public string Capability { get; } = capability;

    /// <summary>Matches <see cref="RequiresCapabilityAttribute.RequiredPermission"/> exactly, so both halves of the model share one identifier format.</summary>
    public string RequiredPermission =>
        $"{RequiresCapabilityAttribute.FeatureKey}.{Module.ToLowerInvariant()}:{Capability}";

    // Not reusable: the filter takes a scoped client, so it is built per request.
    public bool IsReusable => false;

    public IFilterMetadata CreateInstance(IServiceProvider services) =>
        new Filter(Module, Capability, RequiredPermission, services.GetRequiredService<FineCapabilityClient>());

    private sealed class Filter(string module, string capability, string requiredPermission, FineCapabilityClient client)
        : IAsyncAuthorizationFilter
    {
        public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
        {
            var user = context.HttpContext.User;

            if (user.Identity?.IsAuthenticated != true)
            {
                context.Result = new UnauthorizedResult();
                return;
            }

            // The single administrator signal AuthService issues — the same one every other filter in
            // the platform checks, and deliberately not a role-name test.
            if (user.FindFirst(JwtClaimTypes.Administrator)?.Value == "true")
            {
                return;
            }

            if (!Guid.TryParse(user.FindFirst(JwtClaimTypes.Subject)?.Value, out var userId))
            {
                context.Result = new UnauthorizedResult();
                return;
            }

            var held = await client.GetForUserAsync(userId, context.HttpContext.RequestAborted);

            if (!held.Contains(requiredPermission, StringComparer.OrdinalIgnoreCase))
            {
                context.Result = new ObjectResult(new ProblemDetails
                {
                    Title = $"You don't have '{capability}' access to {module}.",
                    Status = StatusCodes.Status403Forbidden,
                    Detail = $"Required permission: {requiredPermission}",
                })
                { StatusCode = StatusCodes.Status403Forbidden };
            }
        }
    }
}
