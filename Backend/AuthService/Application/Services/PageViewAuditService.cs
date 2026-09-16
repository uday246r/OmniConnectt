using AuthService.Application.Navigation;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Caching;
using Microsoft.EntityFrameworkCore;

namespace AuthService.Application.Services;

public enum PageViewOutcome
{
    Recorded,
    /// <summary>The same person opened the same page within <see cref="PageViewAuditService.DedupeWindow"/>; one row already covers it.</summary>
    Duplicate,
    /// <summary>Not a page this person can open. Nothing is written.</summary>
    Refused,
}

/// <summary>
/// Records that a signed-in person opened a page, in the platform audit trail.
/// </summary>
/// <remarks>
/// <para>
/// Page views are the highest-volume thing the trail records — every click in the sidebar, for every
/// user — so three things keep them from becoming a cost or a noise problem:
/// </para>
/// <list type="bullet">
/// <item>A refresh, a back-and-forth, or React re-rendering the same route produces one row, not many:
/// the same person and page inside <see cref="DedupeWindow"/> is written once. The marker lives in
/// <see cref="IPlatformCache"/>, so it holds across replicas when Redis is configured.</item>
/// <item>The endpoint has its own per-user rate limit (<c>RateLimitPolicies.PageViews</c>).</item>
/// <item>Rows are written without the live "audit log changed" push, so every open Audit Logs screen
/// does not refetch on every click anyone makes (see <see cref="AuditLogAppService.WriteAsync"/>).</item>
/// </list>
/// </remarks>
public class PageViewAuditService(
    NavigationAppService navigation,
    AuditLogAppService auditLog,
    IPlatformCache cache,
    AuthDbContext db)
{
    public const string Action = "page.viewed";

    public static readonly TimeSpan DedupeWindow = TimeSpan.FromSeconds(30);

    private sealed record Seen(DateTimeOffset At);

    public async Task<PageViewOutcome> RecordAsync(
        Guid userId,
        string? userName,
        IReadOnlySet<string> permissions,
        bool isAdministrator,
        string? path,
        string? sourceIp,
        string? userAgent,
        CancellationToken ct = default)
    {
        if (PageViewResolver.Normalize(path) is null)
        {
            return PageViewOutcome.Refused;
        }

        var tree = await navigation.GetAsync(permissions, isAdministrator, ct);
        var page = PageViewResolver.Resolve(tree.Sections, path, permissions, isAdministrator);
        if (page is null)
        {
            return PageViewOutcome.Refused;
        }

        var dedupeKey = $"audit:page-view:{userId:N}:{page.Path}";
        if (await cache.GetAsync<Seen>(dedupeKey, ct) is not null)
        {
            return PageViewOutcome.Duplicate;
        }
        await cache.SetAsync(dedupeKey, new Seen(DateTimeOffset.UtcNow), DedupeWindow, ct);

        string? entityType = "Page";
        string? entityId = page.Path;
        var entityLabel = page.Application == PageViewResolver.HostApplication ? page.Module : $"{page.Application} — {page.Module}";
        var details = page.Description;

        if (page.UserId is { } viewedUserId)
        {
            // Named, so the row reads "Opened the profile of Priya Nair." and appears on Priya's own
            // audit tab. A user id that matches nobody is still a real visit to a real page.
            var name = await db.Users.IgnoreQueryFilters().AsNoTracking()
                .Where(u => u.Id == viewedUserId)
                .Select(u => u.Name)
                .FirstOrDefaultAsync(ct);

            entityType = "User";
            entityId = viewedUserId.ToString();
            entityLabel = name ?? "Unknown user";
            details = name is null ? "Opened a user profile that no longer exists." : $"Opened the profile of {name}.";
        }

        await auditLog.WriteAsync(
            AuditLogAppService.HostServiceName, userId, userName, Action,
            entityType, entityId, details,
            sourceIp: sourceIp, userAgent: userAgent, entityLabel: entityLabel,
            sourceApplication: page.Application, module: page.Module, page: page.PageKey,
            actionCategory: AuditLogAppService.Categories.Navigation, ct: ct);

        return PageViewOutcome.Recorded;
    }
}
