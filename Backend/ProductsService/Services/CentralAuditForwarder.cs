using Microsoft.Extensions.Options;
using ProductMarketplace.Api.Infrastructure;
using ProductMarketplace.Api.Options;
using ProductMarketplace.Application.Common;
using ProductMarketplace.Application.Interfaces;

namespace ProductMarketplace.Api.Services;

/// <summary>
/// Copies every Products & Marketplace audit entry into the platform's central audit trail.
/// </summary>
/// <remarks>
/// <para>
/// Before this, the marketplace kept its trail entirely to itself: the host's Audit Logs never showed a
/// product being created or an application being approved, and nothing done here appeared in a user's
/// activity history. The local trail still exists — the remote's own Audit Logs screen reads it — and
/// every entry is now also sent centrally, the same dual-write Lead Management and Customer 360 use.
/// </para>
/// <para>
/// Central keys are the local key prefixed with the app key (<c>products.product.create</c>), so they
/// never collide with another application's vocabulary and filter as one family in the host.
/// </para>
/// <para>
/// Free-text product searches are the one exception. They are search analytics — every keystroke-settled
/// query from every customer — and belong in this app's own search statistics, not in the platform's
/// security trail, where at scale they would bury the actions an auditor is looking for.
/// </para>
/// </remarks>
public class CentralAuditForwarder(AuthServiceClient authService, IOptions<SelfOptions> self) : IAuditForwarder
{
    public Task ForwardAsync(AuditForwardEntry entry, CancellationToken ct = default)
    {
        if (entry.Action == AuditActions.Search)
        {
            return Task.CompletedTask;
        }

        var (module, page) = Describe(entry.EntityType);
        return authService.PushAuditLogAsync(
            action: CentralActionKey(self.Value.AppKey, entry.Action),
            entityType: entry.EntityType,
            entityId: entry.EntityId?.ToString(),
            details: entry.Description,
            actorUserId: entry.ActorUserId,
            actorName: entry.ActorName,
            entityLabel: string.IsNullOrWhiteSpace(entry.EntityName) ? null : entry.EntityName,
            module: module,
            page: page,
            actionCategory: CategoryFor(entry.Action),
            success: entry.Success,
            ct: ct);
    }

    public static string CentralActionKey(string appKey, string localAction) => $"{appKey.ToLowerInvariant()}.{localAction}";

    /// <summary>The platform's category vocabulary, so the host's Category filter works for these rows too.</summary>
    public static string CategoryFor(string localAction)
    {
        if (localAction.EndsWith(".view", StringComparison.Ordinal)) return "ViewDetails";
        if (localAction.EndsWith(".export", StringComparison.Ordinal) || localAction.EndsWith(".exported", StringComparison.Ordinal)) return "Export";
        if (localAction.StartsWith("status_config.", StringComparison.Ordinal)
            || localAction.StartsWith("field.", StringComparison.Ordinal)
            || localAction.StartsWith("product_type.", StringComparison.Ordinal)
            || localAction.StartsWith("document_definition.", StringComparison.Ordinal)
            || localAction.StartsWith("employment_type.", StringComparison.Ordinal)
            || localAction.StartsWith("ranking_config.", StringComparison.Ordinal))
        {
            return "Configuration";
        }

        return "CRUD";
    }

    /// <summary>The page an entity is managed on — the same labels the sidebar shows.</summary>
    public static (string Module, string Page) Describe(string entityType) => entityType switch
    {
        AuditEntityTypes.Product => ("Products", "products"),
        AuditEntityTypes.Category => ("Categories", "categories"),
        AuditEntityTypes.Promotion => ("Promotions", "promotions"),
        AuditEntityTypes.Review => ("Products", "products"),
        AuditEntityTypes.Application => ("Applications", "applications"),
        "AuditLog" => ("Audit Logs", "audit-logs"),
        _ => ("Setup", "setup"),
    };
}
