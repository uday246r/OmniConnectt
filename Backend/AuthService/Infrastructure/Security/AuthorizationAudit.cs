using AuthService.Application.Services;
using Microsoft.AspNetCore.Mvc.Filters;

namespace AuthService.Infrastructure.Security;

/// <summary>
/// Writes the audit row for a refused request, from inside the authorization filter that refused it.
/// </summary>
/// <remarks>
/// <para>
/// Authorization failures were invisible. The trail recorded what people were permitted to do and
/// said nothing about what they attempted and were stopped from doing — so a compromised account
/// probing for reachable endpoints, or a role misconfiguration blocking someone from their own job,
/// both looked identical to a quiet day. Those are the two things a reviewer most wants to see, and
/// neither left a mark.
/// </para>
/// <para>
/// Writing it here rather than at each endpoint is deliberate: there is exactly one place a
/// permission check can fail, so every gated endpoint in the service is covered without a line of
/// per-controller code, and an endpoint added tomorrow is covered the moment it carries the
/// attribute. The filters are plain attributes with no constructor injection, hence the resolve from
/// <c>RequestServices</c> — scoped services are available in the authorization stage.
/// </para>
/// <para>
/// Only refusals are recorded. Auditing every successful check would write a row per request, which
/// is telemetry, not an audit trail — it would bury the refusals in noise and put a database write
/// on the hot path of every call.
/// </para>
/// </remarks>
internal static class AuthorizationAudit
{
    public static async Task RecordDeniedAsync(
        AuthorizationFilterContext context, string action, string requiredPermission, string failureReason)
    {
        try
        {
            var auditLog = context.HttpContext.RequestServices.GetService<AuditLogAppService>();
            if (auditLog is null)
            {
                return;
            }

            var user = context.HttpContext.User;
            var actorId = Guid.TryParse(user.FindFirst("sub")?.Value, out var parsed) ? parsed : (Guid?)null;
            var actorName = user.FindFirst("name")?.Value ?? user.FindFirst("email")?.Value;

            await auditLog.WriteHostAsync(
                actorId, actorName, action,
                AuditLogAppService.Modules.Authentication, AuditLogAppService.Categories.Authorization,
                // The permission is the entity here — "what was demanded" is the fact being recorded,
                // and it is what makes a run of these rows readable as a pattern rather than a list of
                // unrelated 403s.
                entityType: "Permission",
                entityId: requiredPermission,
                entityLabel: requiredPermission,
                details: $"{context.HttpContext.Request.Method} {context.HttpContext.Request.Path} was refused: {failureReason}.",
                sourceIp: context.HttpContext.Connection.RemoteIpAddress?.ToString(),
                userAgent: context.HttpContext.Request.Headers.UserAgent.ToString() is { Length: > 0 } ua ? ua : null,
                result: "Failure",
                failureReason: failureReason,
                ct: context.HttpContext.RequestAborted);
        }
        catch (Exception)
        {
            /*
             * Swallowed on purpose, and this is the one place in the audit work where that is right.
             *
             * The caller is already being refused. If recording the refusal throws — the database is
             * unreachable, the request is being torn down — letting it propagate would turn a correct
             * 403 into a 500, which tells an attacker that their probe did something unusual and tells
             * a legitimate user nothing useful. The authorization decision itself is never affected by
             * whether it could be written down.
             */
        }
    }
}
