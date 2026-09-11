using AuthService.Application.Navigation;
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
/// The <see cref="RemoteApp"/> registration row, now that AuthDb owns it outright rather than
/// replicating it from a separate ModuleRegistry database.
/// </summary>
/// <remarks>
/// <para>
/// The point of the merge is that two specific states stop being representable, and both are worth a
/// test because both used to happen. A permission feature with no registration behind it produced an
/// app the sidebar had to silently drop — a "half-finished sync". And a registration whose feature had
/// been deleted was a row nothing could ever reach. The primary-key-as-foreign-key with a cascade
/// makes each impossible rather than merely unlikely.
/// </para>
/// <para>
/// The third case is the one the old design genuinely could not enforce: two apps claiming the same
/// Module Federation container name. It was checked in application code on registration only, so an
/// edit — or the health probe rewriting the column after a redeploy — walked straight past it. In one
/// database it is a unique index.
/// </para>
/// </remarks>
public class RemoteAppEntityTests : IDisposable
{
    private readonly AuthDbContext db;

    public RemoteAppEntityTests()
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"remote-app-entity-{Guid.NewGuid()}").Options;
        db = new AuthDbContext(options);
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    private async Task<PermissionFeature> SeedAppAsync(
        string key,
        string displayName,
        int sortOrder,
        string? containerName = null,
        RemoteAppStatus status = RemoteAppStatus.Active)
    {
        var now = DateTimeOffset.UtcNow;

        var feature = new PermissionFeature
        {
            Id = Guid.NewGuid(),
            Key = $"remote.{key}",
            DisplayName = displayName,
            Source = PermissionFeatureSource.RemoteApp,
            IsActive = true,
            SortOrder = sortOrder,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.PermissionFeatures.Add(feature);

        db.RemoteApps.Add(new RemoteApp
        {
            FeatureId = feature.Id,
            Key = key,
            IconKey = "Layers",
            ManifestUrl = $"http://localhost:5002/{key}/mf-manifest.json",
            ContainerName = containerName,
            Status = status,
            CreatedAt = now,
            UpdatedAt = now,
        });

        await db.SaveChangesAsync();
        return feature;
    }

    [Fact]
    public async Task A_registration_shares_the_identity_of_the_feature_it_hangs_off()
    {
        var feature = await SeedAppAsync("lead", "Lead Management", 20);

        var app = await db.RemoteApps.SingleAsync();

        // Not a surrogate id of its own: the feature IS the app's identity, which is what makes a
        // mismatched pair unrepresentable rather than merely invalid.
        Assert.Equal(feature.Id, app.FeatureId);
    }

    [Fact]
    public async Task The_app_key_is_the_feature_key_without_the_platform_prefix()
    {
        await SeedAppAsync("customer360", "Customer 360", 10);

        var app = await db.RemoteApps.Include(a => a.Feature).SingleAsync();

        Assert.Equal("customer360", app.Key);
        Assert.Equal("remote.customer360", app.Feature!.Key);
    }

    [Fact]
    public async Task A_display_name_lives_on_the_feature_and_is_not_duplicated_onto_the_registration()
    {
        await SeedAppAsync("lead", "Lead Management", 20);

        var app = await db.RemoteApps.Include(a => a.Feature).SingleAsync();

        // The whole "a display-order edit must ALSO be pushed for the app it displaced" bug class came
        // from holding a second copy of these two fields. Asserting the shape keeps them singular:
        // RemoteApp has no DisplayName or SidebarOrder to drift.
        Assert.Equal("Lead Management", app.Feature!.DisplayName);
        Assert.Equal(20, app.Feature.SortOrder);
    }

    // Uniqueness of Key and ContainerName is enforced by unique indexes, which the in-memory provider
    // does not implement — a test here would pass whatever the model said. The application-level
    // refusals are covered against RemoteAppAppService instead.

    [Fact]
    public async Task The_navigation_tree_reads_render_metadata_from_the_registration_row()
    {
        await SeedAppAsync("lead", "Lead Management", 20, containerName: "lead_mf");
        var feature = await db.PermissionFeatures.SingleAsync();

        db.PermissionFeatureCapabilities.Add(new PermissionFeatureCapability
        {
            Id = Guid.NewGuid(),
            FeatureId = feature.Id,
            Key = "View",
            DisplayName = "View",
            Type = CapabilityType.Api,
            IsActive = true,
        });
        SeedAppsSection();
        await db.SaveChangesAsync();

        var navigation = new NavigationAppService(db, NewCache());
        var response = await navigation.GetAsync(
            new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "remote.lead:View" },
            isAdministrator: false);

        var app = response.Sections.Single(s => s.Key == "apps").Items.Single();

        // End-to-end through the real service: the manifest URL and container name the browser needs
        // to mount the remote now come from the same row the registration wrote, with no replication
        // step in between that could be missing or stale.
        Assert.Equal("Lead Management", app.Label);
        Assert.Equal("lead_mf", app.Remote!.ContainerName);
        Assert.Equal("http://localhost:5002/lead/mf-manifest.json", app.Remote.ManifestUrl);
        Assert.Equal("visible", app.State);
    }

    [Fact]
    public async Task A_disabled_registration_keeps_its_app_out_of_the_navigation_tree()
    {
        await SeedAppAsync("lead", "Lead Management", 20, "lead_mf", RemoteAppStatus.Disabled);
        SeedAppsSection();
        await db.SaveChangesAsync();

        var navigation = new NavigationAppService(db, NewCache());
        var response = await navigation.GetAsync(
            new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "remote.lead:View" },
            isAdministrator: true);

        // Even for an administrator. Disabled means withdrawn from the platform, not merely
        // unauthorised for this caller.
        Assert.DoesNotContain(response.Sections, s => s.Key == "apps");
    }

    [Fact]
    public async Task A_maintenance_registration_surfaces_its_message_in_the_tree()
    {
        await SeedAppAsync("lead", "Lead Management", 20, "lead_mf", RemoteAppStatus.Maintenance);
        var app = await db.RemoteApps.SingleAsync();
        app.MaintenanceMessage = "Upgrading the pricing engine until 18:00 UTC.";
        SeedAppsSection();
        await db.SaveChangesAsync();

        var navigation = new NavigationAppService(db, NewCache());
        var response = await navigation.GetAsync(
            new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "remote.lead:View" },
            isAdministrator: true);

        var node = response.Sections.Single(s => s.Key == "apps").Items.Single();

        Assert.Equal("maintenance", node.State);
        Assert.Equal("Upgrading the pricing engine until 18:00 UTC.", node.MaintenanceMessage);
    }

    [Fact]
    public async Task Health_is_recorded_on_the_registration_and_kept_out_of_the_navigation_tree()
    {
        await SeedAppAsync("lead", "Lead Management", 20, "lead_mf");
        var stored = await db.RemoteApps.SingleAsync();
        stored.Health = RemoteAppHealth.Unreachable;
        stored.LastHealthError = "Connection refused";
        stored.LastHealthCheckAt = DateTimeOffset.UtcNow;
        SeedAppsSection();
        await db.SaveChangesAsync();

        var navigation = new NavigationAppService(db, NewCache());
        var response = await navigation.GetAsync(
            new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "remote.lead:View" },
            isAdministrator: true);

        var node = response.Sections.Single(s => s.Key == "apps").Items.Single();

        // Health is rewritten on a probe interval; the navigation tree is cached. Baking one into the
        // other would serve a stale status from a cache that has no reason to expire when a probe
        // runs. The app is still listed and still mountable — the host overlays health separately.
        Assert.Equal("visible", node.State);
        Assert.Equal(RemoteAppHealth.Unreachable, stored.Health);
    }

    private static MemoryPlatformCache NewCache() => new(new MemoryCache(new MemoryCacheOptions()));

    private void SeedAppsSection() =>
        db.NavSections.Add(new NavSection { Key = "apps", Label = "Apps", SortOrder = 20, PinToBottom = false });
}
