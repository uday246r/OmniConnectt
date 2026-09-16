using System.IdentityModel.Tokens.Jwt;
using AuthService.Application.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace AuthService.Infrastructure.Security;

/// <summary>
/// Enforces a fine-grained capability — one deliberately not carried in the JWT.
/// </summary>
/// <remarks>
/// The counterpart to <see cref="RequirePermissionAttribute"/>, which reads the <c>perms</c> claim.
/// This one resolves from <see cref="FineCapabilityService"/> instead, because these capabilities are
/// not in the token. Everything else about it is the same: same permission-string format, same
/// administrator bypass, same 403, and — importantly — the same authorization stage, so a refusal
/// still precedes model binding and cannot be pre-empted by a 400.
/// <para>
/// Hiding a widget in the browser is a rendering decision. This is the control. Any endpoint whose
/// data backs a gated widget should carry it, or the widget is hidden while its data stays one
/// <c>curl</c> away.
/// </para>
/// </remarks>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class, AllowMultiple = true)]
public class RequiresFineCapabilityAttribute(string featureKey, string capability) : Attribute, IFilterFactory
{
    // Not reusable: the filter it creates is resolved per request so it can take a scoped DbContext.
    public bool IsReusable => false;

    public IFilterMetadata CreateInstance(IServiceProvider services) =>
        new Filter(featureKey, capability, services.GetRequiredService<FineCapabilityService>());

    private sealed class Filter(string featureKey, string capability, FineCapabilityService capabilities)
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

            if (user.FindFirst(JwtTokenService.AdministratorClaimType)?.Value == "true")
            {
                return;
            }

            if (!Guid.TryParse(user.FindFirst(JwtRegisteredClaimNames.Sub)?.Value, out var userId))
            {
                context.Result = new UnauthorizedResult();
                return;
            }

            var required = $"{featureKey}:{capability}";

            IReadOnlyList<string> held;
            try
            {
                held = await capabilities.GetForUserAsync(userId, context.HttpContext.RequestAborted);
            }
            catch (Exception) when (!context.HttpContext.RequestAborted.IsCancellationRequested)
            {
                // Fail closed. If the set cannot be resolved, the answer is "no", never "assume yes" —
                // a database blip must not become an open door. Rethrowing would surface as a 500,
                // which reads as a server fault rather than a refusal and invites a retry loop.
                held = [];
            }

            if (!held.Contains(required, StringComparer.OrdinalIgnoreCase))
            {
                context.Result = new ObjectResult(new ProblemDetails
                {
                    Title = $"You don't have '{capability}' access to '{featureKey}'.",
                    Status = StatusCodes.Status403Forbidden,
                })
                { StatusCode = StatusCodes.Status403Forbidden };

                await AuthorizationAudit.RecordDeniedAsync(
                    context, "authz.denied", required, $"The caller does not hold '{required}'");
            }
        }
    }
}
