using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Caching;
using AuthService.Infrastructure.Seed;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// Who is allowed to see what in the permission catalog.
/// </summary>
/// <remarks>
/// <para>
/// This endpoint had no permission check at all, so any authenticated user could enumerate every
/// feature, sub-module and capability the platform contains — the complete product inventory,
/// including modules they have no business knowing exist. That directly contradicts the sidebar,
/// which omits a row the caller cannot use rather than rendering it as a disabled hint, precisely so
/// the response never advertises what is behind it.
/// </para>
/// <para>
/// Gating the endpoint outright would have been wrong in the other direction: the profile screen
/// reads this catalog for EVERY user, to turn a raw "remote.lead:View" into readable text. So the
/// response is scoped to the caller instead, and these cases pin both halves of that.
/// </para>
/// </remarks>
public class PermissionCatalogScopeTests : IDisposable
{
    private readonly AuthDbContext db;
    private readonly MemoryCache memory = new(new MemoryCacheOptions());
    private readonly PermissionCatalogAppService catalog;

    public PermissionCatalogScopeTests()
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"catalog-scope-{Guid.NewGuid()}").Options;
        db = new AuthDbContext(options);

        var cache = new MemoryPlatformCache(memory);
        catalog = new PermissionCatalogAppService(db, cache, new FineCapabilityService(db, cache));
    }

    public void Dispose()
    {
        db.Dispose();
        memory.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <summary>Two remote apps, one with a sub-module, plus the two host settings features.</summary>
    private async Task SeedCatalogAsync()
    {
        await catalog.UpsertRemoteAppFeatureAsync(
            "remote.lead", "Lead Management", 20,
            [new UpsertCapabilityRequest("View", "View")],
            [new UpsertModuleRequest("dashboard", "Dashboard", 10, [new UpsertCapabilityRequest("View", "View")])]);

        await catalog.UpsertRemoteAppFeatureAsync(
            "remote.customer360", "Customer 360", 10, [new UpsertCapabilityRequest("View", "View")], []);

        await catalog.UpsertRemoteAppFeatureAsync(
            AuthDbSeeder.HostFeatureKeys.SettingsUsers, "Users", 5, [new UpsertCapabilityRequest("View", "View")], []);
    }

    private static HashSet<string> Held(params string[] permissions) =>
        permissions.ToHashSet(StringComparer.OrdinalIgnoreCase);

    [Fact]
    public async Task An_administrator_sees_every_feature()
    {
        await SeedCatalogAsync();

        var result = await catalog.GetCatalogForCallerAsync(true, Held(), isAdministrator: true);

        Assert.Equal(3, result.Count);
    }

    [Fact]
    public async Task A_role_editor_sees_every_feature_including_ones_they_do_not_hold()
    {
        await SeedCatalogAsync();

        var result = await catalog.GetCatalogForCallerAsync(
            true, Held($"{AuthDbSeeder.HostFeatureKeys.SettingsRoles}:View"), isAdministrator: false);

        // The whole point of a role editor is granting what the editor does not personally have.
        // Scoping them to their own permissions would make most of the product ungrantable.
        Assert.Equal(3, result.Count);
    }

    [Fact]
    public async Task A_user_editor_sees_every_feature_too()
    {
        await SeedCatalogAsync();

        var result = await catalog.GetCatalogForCallerAsync(
            true, Held($"{AuthDbSeeder.HostFeatureKeys.SettingsUsers}:View"), isAdministrator: false);

        Assert.Equal(3, result.Count);
    }

    [Fact]
    public async Task A_user_with_no_settings_access_sees_only_the_features_they_hold()
    {
        await SeedCatalogAsync();

        var result = await catalog.GetCatalogForCallerAsync(
            true, Held("remote.lead:View"), isAdministrator: false);

        // Customer 360 exists and they hold nothing on it, so they are not told it exists.
        Assert.Equal("remote.lead", Assert.Single(result).Key);
    }

    [Fact]
    public async Task A_capability_on_a_sub_module_reveals_its_parent_but_no_sibling()
    {
        await SeedCatalogAsync();

        var result = await catalog.GetCatalogForCallerAsync(
            true, Held("remote.lead.dashboard:View"), isAdministrator: false);

        // The two-prefix rule again: "remote.lead.dashboard:View" does not start with "remote.lead:",
        // so a colon-only check would have hidden the app from a user who plainly has access to part
        // of it.
        var app = Assert.Single(result);
        Assert.Equal("remote.lead", app.Key);
        Assert.Equal("remote.lead.dashboard", Assert.Single(app.Children).Key);
    }

    [Fact]
    public async Task A_sub_module_the_caller_holds_nothing_on_is_stripped_from_its_parent()
    {
        await SeedCatalogAsync();

        var result = await catalog.GetCatalogForCallerAsync(
            true, Held("remote.lead:View"), isAdministrator: false);

        // Holding something on the app itself must not hand back the full list of its sub-modules —
        // that is the same inventory leak one level down.
        Assert.Empty(Assert.Single(result).Children);
    }

    [Fact]
    public async Task A_user_holding_nothing_at_all_sees_an_empty_catalog()
    {
        await SeedCatalogAsync();

        var result = await catalog.GetCatalogForCallerAsync(true, Held(), isAdministrator: false);

        Assert.Empty(result);
    }

    [Fact]
    public async Task A_permission_for_a_similarly_named_app_does_not_reveal_this_one()
    {
        await SeedCatalogAsync();

        var result = await catalog.GetCatalogForCallerAsync(
            true, Held("remote.lead-archive:View"), isAdministrator: false);

        Assert.Empty(result);
    }

    [Fact]
    public async Task The_unscoped_read_still_returns_everything_for_internal_callers()
    {
        await SeedCatalogAsync();

        // The checker-assignment module list and the remote-app resync both need the whole catalog and
        // answer no user directly.
        Assert.Equal(3, (await catalog.GetCatalogAsync(activeOnly: true)).Count);
    }
}
