using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using AuthService.Application.DTOs;
using AuthService.Application.Navigation;
using AuthService.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace AuthService.Application.Services;

/// <summary>
/// Serves the whole sidebar from AuthDb in one read.
/// <para>
/// AuthService owns this rather than the Module Registry because the tree needs both halves at once:
/// the permission hierarchy and the caller's effective permissions live here, while the apps' render
/// metadata is replicated in by the existing sync. Joining live across services would put a second
/// service on the first-paint path of every authenticated page — and if AuthService is down nobody
/// has a token anyway, so served from here the sidebar's availability is exactly login's.
/// </para>
/// </summary>
public class NavigationAppService(AuthDbContext db, IMemoryCache cache)
{
    /// <summary>Shared so writers elsewhere can evict it without taking a dependency on this service.</summary>
    public const string CatalogCacheKey = "nav:catalog";
    private static readonly TimeSpan CatalogTtl = TimeSpan.FromSeconds(60);

    public async Task<NavigationResponseDto> GetAsync(
        IReadOnlySet<string> permissions,
        bool isAdministrator,
        CancellationToken ct = default)
    {
        var catalog = await GetCatalogAsync(ct);
        var now = DateTimeOffset.UtcNow;

        var sections = NavigationTreeBuilder.Build(catalog, permissions, isAdministrator);

        return new NavigationResponseDto(ComputeVersion(sections), now, sections);
    }

    /// <summary>
    /// The user-independent half of the tree. Cached because it is identical for every caller and
    /// changes only when a remote resyncs its navigation, which evicts it.
    /// </summary>
    private async Task<NavigationCatalogSnapshot> GetCatalogAsync(CancellationToken ct)
    {
        if (cache.TryGetValue<NavigationCatalogSnapshot>(CatalogCacheKey, out var cached) && cached is not null)
        {
            return cached;
        }

        var features = await db.PermissionFeatures
            .AsNoTracking()
            .Include(f => f.Capabilities)
            .ToListAsync(ct);

        var navItems = await db.FeatureNavItems.AsNoTracking().ToListAsync(ct);
        var render = await db.RemoteAppNavMetadata.AsNoTracking().ToListAsync(ct);

        // Sections and host rows are seeded data, cached with the rest of the catalog so making the
        // sidebar configurable costs no extra query per request.
        var sections = await db.NavSections.AsNoTracking().ToListAsync(ct);
        var hostItems = await db.HostNavItems.AsNoTracking().ToListAsync(ct);

        var keyById = features.ToDictionary(f => f.Id, f => f.Key);

        var snapshot = new NavigationCatalogSnapshot(
            features
                .Select(f => new NavFeature(
                    f.Key,
                    f.DisplayName,
                    f.SortOrder,
                    f.ParentFeatureId is { } pid && keyById.TryGetValue(pid, out var parentKey) ? parentKey : null,
                    f.IsActive,
                    f.Capabilities.Select(c => c.Key).ToList()))
                .ToList(),
            navItems
                .Where(n => keyById.ContainsKey(n.FeatureId))
                .GroupBy(n => keyById[n.FeatureId])
                .ToDictionary(
                    g => g.Key,
                    g => (IReadOnlyList<NavItemRow>)g
                        .Select(n => new NavItemRow(n.NavKey, n.Label, n.IconKey, n.RouteSegment, n.SortOrder, n.RequiredCapability))
                        .ToList(),
                    StringComparer.OrdinalIgnoreCase),
            render
                .Where(m => keyById.ContainsKey(m.FeatureId))
                .ToDictionary(
                    m => keyById[m.FeatureId],
                    m => new NavRenderMetadata(m.IconKey, m.ManifestUrl, m.ContainerName, m.Status, m.MaintenanceMessage),
                    StringComparer.OrdinalIgnoreCase),
            sections
                .OrderBy(s => s.SortOrder)
                .Select(s => new NavSectionRow(s.Key, s.Label, s.SortOrder, s.PinToBottom))
                .ToList(),
            hostItems
                .OrderBy(h => h.SortOrder)
                .Select(h => new HostNavRow(h.Key, h.Label, h.IconKey, h.RoutePath, h.SectionKey, h.SortOrder, h.RequiredFeatureKey, h.RequiredCapability))
                .ToList());

        cache.Set(CatalogCacheKey, snapshot, CatalogTtl);
        return snapshot;
    }

    /// <summary>Drops the cached catalog so the next request rebuilds it. Called after a permission sync.</summary>
    public void Invalidate() => cache.Remove(CatalogCacheKey);

    /// <summary>
    /// A hash of the rendered tree, used as the ETag.
    /// <para>
    /// Hashing the OUTPUT rather than the inputs is deliberate: the tree is per-user, so an input
    /// hash shared across callers would let one user's 304 be served against another user's very
    /// different sidebar. It costs one serialization of a small object.
    /// </para>
    /// </summary>
    private static string ComputeVersion(IReadOnlyList<NavSectionDto> sections)
    {
        var json = JsonSerializer.Serialize(sections);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json)))[..16];
    }
}
