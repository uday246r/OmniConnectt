using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Options;
using ProductMarketplace.Api.Options;

namespace ProductMarketplace.Api.Infrastructure.Security;

/// <summary>
/// Enforces a capability that is deliberately not in the JWT — an export, a chart, a panel — by asking
/// AuthService through <see cref="FineCapabilityClient"/>.
/// </summary>
/// <remarks>
/// Same identifier format, administrator bypass and 403 as <see cref="RequiresCapabilityAttribute"/>;
/// only the source differs. It fails closed: an unanswerable question about a permission is "no".
/// </remarks>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class, AllowMultiple = true)]
public class RequiresFineCapabilityAttribute(string module, string capability) : Attribute, IFilterFactory
{
    public string Module { get; } = module;
    public string Capability { get; } = capability;

    public bool IsReusable => false;

    public IFilterMetadata CreateInstance(IServiceProvider services) =>
        new Filter(Module, Capability, services.GetRequiredService<FineCapabilityClient>(), services.GetRequiredService<IOptions<SelfOptions>>().Value.AppKey);

    private sealed class Filter(string module, string capability, FineCapabilityClient client, string appKey) : IAsyncAuthorizationFilter
    {
        public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
        {
            var user = context.HttpContext.User;
            if (user.Identity?.IsAuthenticated != true)
            {
                context.Result = new UnauthorizedResult();
                return;
            }

            if (user.FindFirst(JwtClaimTypes.Administrator)?.Value == "true")
            {
                return;
            }

            if (!Guid.TryParse(user.FindFirst(JwtClaimTypes.Subject)?.Value, out var userId))
            {
                context.Result = new UnauthorizedResult();
                return;
            }

            var required = PlatformPermissions.PermissionFor(appKey, module, capability);
            var held = await client.GetForUserAsync(userId, context.HttpContext.RequestAborted);
            if (!held.Contains(required, StringComparer.OrdinalIgnoreCase))
            {
                context.Result = new ObjectResult(new ProblemDetails
                {
                    Title = $"You don't have '{capability}' access to {module}.",
                    Status = StatusCodes.Status403Forbidden,
                    Detail = $"Required permission: {required}",
                })
                { StatusCode = StatusCodes.Status403Forbidden };
            }
        }
    }
}
