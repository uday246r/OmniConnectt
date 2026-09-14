using System.Security.Claims;
using ProductMarketplace.Application.Interfaces;

namespace ProductMarketplace.Api.Services;

/// <summary>
/// Resolves the actor recorded on every audit entry.
/// <para>
/// Resolution order is deliberate and does not change when this remote is mounted in the Host App:
/// an authenticated <see cref="ClaimsPrincipal"/> always wins, so the moment the Host App supplies a
/// real authenticated session (it owns identity, roles and permissions - this remote never logs anyone
/// in) the audit trail switches to verified identity with no service change anywhere.
/// </para>
/// <para>
/// The X-Actor-* header fallback exists only for standalone development, where the frontend sends its
/// local current-user context. Those headers are caller-supplied and therefore untrusted: they are
/// honoured only while no authenticated principal exists AND only when
/// <c>Audit:TrustActorHeaders</c> is enabled (default: Development only). In a deployed environment
/// with no authentication wired up yet, the actor is recorded as "System" rather than as whatever the
/// caller claimed, so the trail can never be silently forged.
/// </para>
/// </summary>
public class HttpAuditContext : IAuditContext
{
    public const string SystemActor = "System";

    public string ActorName { get; }
    public string ActorEmail { get; }
    public string? IpAddress { get; }

    public HttpAuditContext(IHttpContextAccessor accessor, IConfiguration configuration, IHostEnvironment environment)
    {
        var httpContext = accessor.HttpContext;
        IpAddress = httpContext?.Connection.RemoteIpAddress?.ToString();

        var user = httpContext?.User;
        if (user?.Identity?.IsAuthenticated == true)
        {
            ActorName = FirstClaim(user, ClaimTypes.Name, "name", "preferred_username") ?? SystemActor;
            ActorEmail = FirstClaim(user, ClaimTypes.Email, "email") ?? string.Empty;
            return;
        }

        var trustHeaders = configuration.GetValue("Audit:TrustActorHeaders", environment.IsDevelopment());
        if (trustHeaders && httpContext is not null)
        {
            ActorName = Trimmed(httpContext.Request.Headers["X-Actor-Name"].FirstOrDefault()) ?? SystemActor;
            ActorEmail = Trimmed(httpContext.Request.Headers["X-Actor-Email"].FirstOrDefault()) ?? string.Empty;
            return;
        }

        ActorName = SystemActor;
        ActorEmail = string.Empty;
    }

    private static string? FirstClaim(ClaimsPrincipal user, params string[] claimTypes) =>
        claimTypes.Select(t => Trimmed(user.FindFirst(t)?.Value)).FirstOrDefault(v => v is not null);

    private static string? Trimmed(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
