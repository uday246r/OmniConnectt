using ProductMarketplace.Api.Infrastructure.Security;
using ProductMarketplace.Application.Interfaces;

namespace ProductMarketplace.Api.Services;

/// <summary>
/// Resolves the actor recorded on every audit entry, from the verified platform token only.
/// </summary>
/// <remarks>
/// <para>
/// This used to fall back to <c>X-Actor-Name</c> / <c>X-Actor-Email</c> request headers whenever no user
/// was signed in — which, with no authentication registered, was always — and that fallback was on by
/// default in Development. The browser chose whose name went on every row. The service now requires a
/// platform token on every business endpoint, and the actor comes from its claims or from nowhere.
/// </para>
/// <para>
/// The one exception is an approval replay. That request comes from AuthService with the internal key
/// and no user token, and everything it writes must be attributed to the maker who asked for the change,
/// not left anonymous — <see cref="AuditActorOverride"/> carries that identity for the request.
/// </para>
/// </remarks>
public class HttpAuditContext : IAuditContext
{
    public const string SystemActor = "System";

    public Guid? UserId { get; }
    public string ActorName { get; }
    public string ActorEmail { get; }
    public string? IpAddress { get; }
    public string? UserAgent { get; }

    public HttpAuditContext(IHttpContextAccessor accessor, AuditActorOverride actorOverride)
    {
        var httpContext = accessor.HttpContext;
        IpAddress = httpContext?.Connection.RemoteIpAddress?.ToString();
        UserAgent = httpContext?.Request.Headers.UserAgent.ToString() is { Length: > 0 } ua ? ua : null;

        if (actorOverride.IsSet)
        {
            UserId = actorOverride.UserId;
            ActorName = actorOverride.UserName ?? SystemActor;
            ActorEmail = string.Empty;
            return;
        }

        var user = httpContext?.User;
        if (user?.Identity?.IsAuthenticated == true)
        {
            UserId = Guid.TryParse(user.FindFirst(JwtClaimTypes.Subject)?.Value, out var id) ? id : null;
            ActorEmail = Trimmed(user.FindFirst(JwtClaimTypes.Email)?.Value) ?? string.Empty;
            ActorName = Trimmed(user.FindFirst(JwtClaimTypes.Name)?.Value) ?? (ActorEmail.Length > 0 ? ActorEmail : SystemActor);
            return;
        }

        ActorName = SystemActor;
        ActorEmail = string.Empty;
    }

    private static string? Trimmed(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

/// <summary>
/// Per-request identity for work done on someone's behalf — set only by the approval replay endpoint,
/// which has verified AuthService's internal key before setting it.
/// </summary>
public class AuditActorOverride
{
    public bool IsSet { get; private set; }
    public Guid? UserId { get; private set; }
    public string? UserName { get; private set; }

    public void AttributeTo(Guid userId, string? userName)
    {
        IsSet = true;
        UserId = userId;
        UserName = userName;
    }
}
