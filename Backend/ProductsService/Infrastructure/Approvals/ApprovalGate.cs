using System.Text.Json;
using Microsoft.Extensions.Options;
using ProductMarketplace.Api.Infrastructure.Security;
using ProductMarketplace.Api.Options;
using ProductMarketplace.Api.Services;

namespace ProductMarketplace.Api.Infrastructure.Approvals;

/// <summary>
/// Decides, for one change, whether it applies now or waits for a checker — and files it when it waits.
/// </summary>
/// <remarks>
/// A module is gated exactly when AuthService has a checker assigned to it, so an administrator turns
/// approval on or off from Setup → Checker Assignment with no deployment. The platform's rules apply
/// unchanged: administrators' own changes are not gated, a replay is never re-gated, and if AuthService
/// cannot say whether approval is needed the change is refused rather than applied.
/// </remarks>
public class ApprovalGate(
    AuthServiceClient authService,
    IOptions<SelfOptions> self,
    IHttpContextAccessor httpContextAccessor,
    AuditActorOverride actorOverride)
{
    /// <summary>The envelope stored as the request's new data: which operation, and its content.</summary>
    public sealed record Envelope(string Operation, JsonElement Payload);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <returns>The pending request when the change was held for approval; null when the caller should apply it now.</returns>
    public async Task<AuthServiceClient.ApprovalPendingDto?> TrySubmitAsync(
        ProductsMutation mutation, string? entityId, string entityLabel, object? body, CancellationToken ct,
        object? before = null)
    {
        if (actorOverride.IsSet)
        {
            return null;
        }

        var user = httpContextAccessor.HttpContext?.User;
        if (user is null || user.FindFirst(JwtClaimTypes.Administrator)?.Value == "true")
        {
            return null;
        }

        if (!Guid.TryParse(user.FindFirst(JwtClaimTypes.Subject)?.Value, out var makerId))
        {
            return null;
        }

        var module = PlatformModuleKey(self.Value.AppKey, mutation.Module);
        if (!await authService.IsGatedAsync(module, ct))
        {
            return null;
        }

        var payload = JsonSerializer.SerializeToElement(body ?? new { }, Json);
        var newData = JsonSerializer.Serialize(new Envelope(mutation.Operation, payload), Json);
        var oldData = before is null ? null : JsonSerializer.Serialize(before, Json);

        // One open request per record: an id when the record exists, the operation plus its name when it
        // does not yet (a create), so two identical creates cannot both wait in the queue.
        var entityKey = entityId is not null
            ? $"{mutation.EntityType}:{entityId}"
            : $"{mutation.Operation}:{entityLabel.Trim().ToLowerInvariant()}";

        return await authService.SubmitApprovalAsync(
            module, mutation.Action, mutation.EntityType, entityId, entityLabel, oldData, newData, makerId, entityKey, ct);
    }

    public static string PlatformModuleKey(string appKey, string module) =>
        $"remote.{appKey.ToLowerInvariant()}.{module.ToLowerInvariant()}";
}
