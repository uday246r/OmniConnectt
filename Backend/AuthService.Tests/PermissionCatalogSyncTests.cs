using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Caching;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// The null-versus-empty contract on a capability sync, and the cache invalidation that has to
/// accompany one.
/// </summary>
/// <remarks>
/// <para>
/// This is the load-bearing consequence of absorbing the Module Registry. That service kept a local
/// copy of every remote's last-known capability set, purely so it had something to re-push when the
/// remote was unreachable. Deleting the copy removes a whole class of drift — but only if the
/// guarantee it accidentally provided is made explicit instead.
/// </para>
/// <para>
/// So: <b>null means the remote said nothing and the stored set stands; an empty list is a real
/// answer and deactivates.</b> That is strictly stronger than the cache was, because a cache could
/// itself be empty or stale and re-push a wrong set, whereas a null cannot say anything at all.
/// </para>
/// <para>
/// The invalidation cases guard a separate bug: deactivating a feature updated the database and told
/// neither cache, so a disabled app stayed in the sidebar and its capabilities stayed grantable for
/// up to a minute. The delete path happened to be covered because it followed up with a full resync.
/// Plain Disable had no such accident behind it.
/// </para>
/// </remarks>
public class PermissionCatalogSyncTests : IDisposable
{
    private const string FeatureKey = "remote.lead";

    private readonly AuthDbContext db;
    private readonly MemoryCache memory = new(new MemoryCacheOptions());
    private readonly MemoryPlatformCache cache;
    private readonly FineCapabilityService fine;
    private readonly PermissionCatalogAppService catalog;

    public PermissionCatalogSyncTests()
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"catalog-sync-{Guid.NewGuid()}").Options;
        db = new AuthDbContext(options);

        cache = new MemoryPlatformCache(memory);
        fine = new FineCapabilityService(db, cache);
        catalog = new PermissionCatalogAppService(db, cache, fine);
    }

    public void Dispose()
    {
        db.Dispose();
        memory.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <summary>Seeds an app that declares one capability of its own and one sub-module.</summary>
    private async Task SeedFullyDeclaredAppAsync() =>
        await catalog.UpsertRemoteAppFeatureAsync(
            FeatureKey, "Lead Management", 20,
            [new UpsertCapabilityRequest("View", "View")],
            [new UpsertModuleRequest("lead", "Leads", 10, [new UpsertCapabilityRequest("Edit", "Edit")])]);

    private async Task<IReadOnlyList<string>> ActiveCapabilityKeysAsync(string featureKey) =>
        await db.PermissionFeatureCapabilities
            .Where(c => c.Feature!.Key == featureKey && c.IsActive)
            .Select(c => c.Key)
            .ToListAsync();

    // ── Null means "said nothing" ────────────────────────────────────────────────

    [Fact]
    public async Task An_unreachable_remote_keeps_every_capability_it_last_declared()
    {
        await SeedFullyDeclaredAppAsync();

        // Null capabilities: discovery could not read the remote.
        await catalog.UpsertRemoteAppFeatureAsync(FeatureKey, "Lead Management", 20, null, null);

        Assert.Equal(["View"], await ActiveCapabilityKeysAsync(FeatureKey));
    }

    [Fact]
    public async Task An_unreachable_remote_keeps_every_sub_module_it_last_declared()
    {
        await SeedFullyDeclaredAppAsync();

        await catalog.UpsertRemoteAppFeatureAsync(FeatureKey, "Lead Management", 20, null, null);

        // The sharper half of the same bug. `modules ?? []` followed by a stale-child sweep meant an
        // unreachable remote deactivated every sub-module it owns — and with them every role grant
        // and user override naming those sub-modules, which is most of what a scoped role holds.
        var submodule = await db.PermissionFeatures.SingleAsync(f => f.Key == $"{FeatureKey}.lead");
        Assert.True(submodule.IsActive);
        Assert.Equal(["Edit"], await ActiveCapabilityKeysAsync($"{FeatureKey}.lead"));
    }

    [Fact]
    public async Task An_unreachable_remote_does_not_lose_its_display_name_or_position()
    {
        await SeedFullyDeclaredAppAsync();

        await catalog.UpsertRemoteAppFeatureAsync(FeatureKey, "Lead Management", 20, null, null);

        var feature = await db.PermissionFeatures.SingleAsync(f => f.Key == FeatureKey);
        Assert.Equal("Lead Management", feature.DisplayName);
        Assert.Equal(20, feature.SortOrder);
        Assert.True(feature.IsActive);
    }

    // ── Empty means "declares nothing" ───────────────────────────────────────────

    [Fact]
    public async Task A_remote_that_genuinely_declares_nothing_has_its_capabilities_deactivated()
    {
        await SeedFullyDeclaredAppAsync();

        // An empty list is a positive statement, not silence.
        await catalog.UpsertRemoteAppFeatureAsync(FeatureKey, "Lead Management", 20, [], []);

        Assert.Empty(await ActiveCapabilityKeysAsync(FeatureKey));
    }

    [Fact]
    public async Task A_sub_module_the_remote_stops_declaring_is_deactivated_not_deleted()
    {
        await SeedFullyDeclaredAppAsync();

        await catalog.UpsertRemoteAppFeatureAsync(
            FeatureKey, "Lead Management", 20, [new UpsertCapabilityRequest("View", "View")], []);

        var submodule = await db.PermissionFeatures.SingleAsync(f => f.Key == $"{FeatureKey}.lead");

        // Still present, so every RolePermission naming it stays intelligible for audit; inactive, so
        // it drops out of the editors and out of the JWT. Deleting it would orphan those grant rows,
        // which are the record of what an administrator actually decided.
        Assert.False(submodule.IsActive);
    }

    [Fact]
    public async Task A_capability_withdrawn_and_later_re_declared_becomes_grantable_again()
    {
        await SeedFullyDeclaredAppAsync();
        var originalId = (await db.PermissionFeatureCapabilities.SingleAsync(c => c.Key == "View")).Id;

        await catalog.UpsertRemoteAppFeatureAsync(FeatureKey, "Lead Management", 20, [], []);
        await SeedFullyDeclaredAppAsync();

        var restored = await db.PermissionFeatureCapabilities.SingleAsync(c => c.Key == "View");

        Assert.True(restored.IsActive);

        // The same row, not a replacement. A capability recreated with a fresh id on every sync could
        // never be referenced by id by anything else.
        Assert.Equal(originalId, restored.Id);
    }

    // ── Invalidation on deactivate ───────────────────────────────────────────────

    [Fact]
    public async Task Disabling_a_remote_app_drops_the_cached_navigation_catalog()
    {
        await SeedFullyDeclaredAppAsync();
        db.RemoteApps.Add(new RemoteApp
        {
            FeatureId = (await db.PermissionFeatures.SingleAsync(f => f.Key == FeatureKey)).Id,
            Key = "lead",
            ManifestUrl = "http://localhost:5002/mf-manifest.json",
            Status = RemoteAppStatus.Active,
        });
        await db.SaveChangesAsync();

        // Something is cached, as it would be after any authenticated page load.
        await cache.SetAsync(NavigationAppService.CatalogCacheKey, new object(), TimeSpan.FromMinutes(1));

        await catalog.DeactivateRemoteAppFeatureAsync(FeatureKey);

        // Without this, a disabled app stayed in every user's sidebar until the 60s TTL elapsed, and
        // no amount of refreshing helped — which reads as "Disable does not work".
        Assert.Null(await cache.GetAsync<object>(NavigationAppService.CatalogCacheKey));
    }

    [Fact]
    public async Task Disabling_a_remote_app_retires_every_cached_fine_capability_set()
    {
        await SeedFullyDeclaredAppAsync();
        var before = await cache.GetVersionAsync("fine-capabilities:version");

        await catalog.DeactivateRemoteAppFeatureAsync(FeatureKey);

        // The fine-grained sets are per user and cannot be enumerated from here, so they are retired
        // in bulk by bumping the version folded into every key. Not bumping it kept serving widgets,
        // charts and export buttons for an app that had just been withdrawn.
        Assert.True(await cache.GetVersionAsync("fine-capabilities:version") > before);
    }

    [Fact]
    public async Task Deactivating_a_feature_that_does_not_exist_is_a_no_op()
    {
        await catalog.DeactivateRemoteAppFeatureAsync("remote.never-registered");

        Assert.Empty(await db.PermissionFeatures.ToListAsync());
    }

    // ── The delivery rule the sync has to respect ────────────────────────────────

    [Fact]
    public async Task A_non_api_capability_is_stored_with_its_declared_type()
    {
        await catalog.UpsertRemoteAppFeatureAsync(
            FeatureKey, "Lead Management", 20, null,
            [new UpsertModuleRequest("dashboard", "Dashboard", 10,
                [new UpsertCapabilityRequest("kpi.total-leads", "Total Leads", 10, null, "Widget")])]);

        var capability = await db.PermissionFeatureCapabilities.SingleAsync(c => c.Key == "kpi.total-leads");

        // The type is what decides delivery — Api goes in the JWT, everything else is fetched
        // separately. Storing it wrong either bloats every token or locks a widget away.
        Assert.Equal(CapabilityType.Widget, capability.Type);

        // And the dotted prefix becomes the group, derived in one place rather than by three hops
        // that could disagree.
        Assert.Equal("kpi", capability.GroupKey);
    }
}
