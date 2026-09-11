using System.Net;
using System.Text;
using AuthService.Application.DTOs;
using AuthService.Application.Events;
using AuthService.Application.Exceptions;
using AuthService.Application.Navigation;
using AuthService.Application.Services;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Caching;
using AuthService.Infrastructure.Remotes;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// Registering, reordering and retiring remote apps, and the health feed the host shell reads.
/// </summary>
/// <remarks>
/// <para>
/// Ported from the retired Module Registry's own suite. Two of its tests asserted that a display-order
/// swap was PUSHED to AuthService correctly — a premise that no longer exists, because there is no
/// second service to push to. The guarantee they protected does still exist, so they are rewritten to
/// assert it where it now lives: the order the sidebar actually renders, and the capabilities that
/// must survive an edit that had nothing to do with them.
/// </para>
/// <para>
/// The ordering rules are worth this much attention because they are the ones a reviewer would assume
/// are trivial. Sidebar position is a plain int with no unique constraint, so "move this app to
/// position 1" has to decide what happens to whatever already holds position 1 — and the wrong answer
/// is silent: two apps share a number, the list falls back to sorting by name, and the position the
/// admin typed decides nothing at all.
/// </para>
/// </remarks>
public class RemoteAppServiceTests : IDisposable
{
    private readonly AuthDbContext db;
    private readonly MemoryCache memory = new(new MemoryCacheOptions());
    private readonly PermissionCatalogAppService catalog;
    private readonly RemoteAppAppService service;

    public RemoteAppServiceTests()
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"remote-app-service-{Guid.NewGuid()}").Options;
        db = new AuthDbContext(options);

        var cache = new MemoryPlatformCache(memory);
        var events = new SilentPublisher();
        var auditLog = new AuditLogAppService(db, events, new HttpContextAccessor());
        var fine = new FineCapabilityService(db, cache);
        catalog = new PermissionCatalogAppService(db, cache, fine);
        var gating = new ApprovalGatingService(db, auditLog, events);

        service = new RemoteAppAppService(
            db,
            catalog,
            new RemoteCapabilityDiscoveryClient(
                new HttpClient(new UnreachableHandler()),
                NullLogger<RemoteCapabilityDiscoveryClient>.Instance),
            new RemoteManifestClient(
                new HttpClient(new ManifestHandler()),
                NullLogger<RemoteManifestClient>.Instance),
            gating,
            auditLog,
            NullLogger<RemoteAppAppService>.Instance);
    }

    public void Dispose()
    {
        db.Dispose();
        memory.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <summary>Every manifest probe succeeds, naming the container after the requested path.</summary>
    private sealed class ManifestHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            // A distinct container per host:port, so the clash check only fires when a test means it to.
            var container = $"c{request.RequestUri!.Port}";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent($$"""{"name":"{{container}}"}""", Encoding.UTF8, "application/json"),
            });
        }
    }

    /// <summary>Capability discovery always fails, which is the "keep last known" path.</summary>
    private sealed class UnreachableHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            throw new HttpRequestException("Connection refused");
    }

    private sealed class SilentPublisher : IPlatformEventPublisher
    {
        public Task PublishToApprovalViewersAsync(PlatformEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task PublishToAuditViewersAsync(PlatformEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task PublishToCheckerAssignmentViewersAsync(PlatformEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task PublishToUsersAsync(IEnumerable<Guid> userIds, PlatformEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task PublishBadgeAsync(Guid userId, int pendingCount, CancellationToken ct = default) => Task.CompletedTask;
        public void RequestKpiRefresh() { }
    }

    private async Task<Guid> RegisterAsync(string key, string displayName, int order, int port = 5002)
    {
        var result = await service.CreateAsync(
            new CreateRemoteAppRequest(key, displayName, "Layers", $"http://localhost:{port}/mf-manifest.json", null, order),
            actingUserId: null, actorName: null);

        return result.Applied!.Id;
    }

    private async Task<int> OrderOfAsync(string key)
    {
        var app = await db.RemoteApps.AsNoTracking().Include(a => a.Feature).SingleAsync(a => a.Key == key);
        return app.Feature!.SortOrder;
    }

    private static UpdateRemoteAppRequest MoveTo(int order, string displayName = "Lead Management") =>
        new(displayName, "Layers", "http://localhost:5002/mf-manifest.json", null, order);

    // ── Registration ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task Registering_an_app_creates_its_permission_feature_and_its_registration_together()
    {
        var id = await RegisterAsync("lead", "Lead Management", 20);

        var app = await db.RemoteApps.Include(a => a.Feature).SingleAsync();

        Assert.Equal(id, app.FeatureId);
        Assert.Equal("remote.lead", app.Feature!.Key);
        Assert.Equal(PermissionFeatureSource.RemoteApp, app.Feature.Source);
        Assert.True(app.Feature.IsActive);
    }

    [Fact]
    public async Task A_registration_records_the_container_name_the_manifest_reported()
    {
        await RegisterAsync("lead", "Lead Management", 20, port: 5002);

        var app = await db.RemoteApps.SingleAsync();

        // Probed at registration rather than left for the first background sweep, so a typo'd or dead
        // manifest URL is an immediate message on the form instead of a Module Federation runtime
        // error in some user's browser later.
        Assert.Equal("c5002", app.ContainerName);
        Assert.Equal(RemoteAppHealth.Healthy, app.Health);
    }

    [Fact]
    public async Task A_second_app_cannot_claim_a_container_name_already_registered()
    {
        await RegisterAsync("lead", "Lead Management", 20, port: 5002);

        var clash = await Assert.ThrowsAsync<ConflictAppException>(
            () => RegisterAsync("lead-archive", "Lead Archive", 30, port: 5002));

        // The container name is a GLOBAL identifier in the browser: two remotes sharing one overwrite
        // each other at runtime. The keys differ, so the key's own uniqueness cannot catch this.
        Assert.Contains("container name", clash.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task A_duplicate_key_is_refused()
    {
        await RegisterAsync("lead", "Lead Management", 20, port: 5002);

        await Assert.ThrowsAsync<ConflictAppException>(
            () => RegisterAsync("lead", "Lead Management Again", 30, port: 5003));
    }

    [Fact]
    public async Task A_key_that_breaks_the_permission_namespace_is_refused_with_the_documented_rule()
    {
        var invalid = await Assert.ThrowsAsync<ValidationAppException>(
            () => RegisterAsync("Lead.Archive", "Lead Archive", 30));

        // A key containing a dot would produce feature keys indistinguishable from a sub-module, and
        // an uppercase one would not match the lowercase namespace everything else assumes. The
        // message is the same sentence the request annotation uses, so a caller sees one rule however
        // they arrived.
        Assert.Contains("lowercase letter", invalid.Message);
    }

    [Fact]
    public async Task An_unreachable_permissions_source_still_registers_the_app()
    {
        var result = await service.CreateAsync(
            new CreateRemoteAppRequest(
                "lead", "Lead Management", "Layers", "http://localhost:5002/mf-manifest.json",
                "http://localhost:5046/permissions", 20),
            actingUserId: null, actorName: null);

        // Discovery fails in this fixture. The registration must still land: an app whose backend is
        // briefly down is not an invalid registration, and refusing it would make deploy order matter.
        Assert.NotNull(result.Applied);
        Assert.True(await db.PermissionFeatures.AnyAsync(f => f.Key == "remote.lead"));
    }

    // ── Display order ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Moving_an_app_onto_an_occupied_position_swaps_the_two()
    {
        await RegisterAsync("customer360", "Customer 360", 1, port: 5003);
        var leadId = await RegisterAsync("lead", "Lead Management", 2, port: 5002);

        await service.UpdateAsync(leadId, MoveTo(1), actingUserId: null, actorName: null);

        // One edit expresses the whole intent. Before this, putting Lead first meant editing Lead AND
        // editing whatever already held position 1, and forgetting the second left both apps sharing
        // a number where the typed position decided nothing.
        Assert.Equal(1, await OrderOfAsync("lead"));
        Assert.Equal(2, await OrderOfAsync("customer360"));
    }

    [Fact]
    public async Task Moving_an_app_writes_the_new_order_where_the_sidebar_reads_it()
    {
        await RegisterAsync("customer360", "Customer 360", 1, port: 5003);
        var leadId = await RegisterAsync("lead", "Lead Management", 2, port: 5002);
        await GrantEveryAppAViewCapabilityAsync();

        await service.UpdateAsync(leadId, MoveTo(1), actingUserId: null, actorName: null);

        var navigation = new NavigationAppService(db, new MemoryPlatformCache(new MemoryCache(new MemoryCacheOptions())));
        var response = await navigation.GetAsync(new HashSet<string>(), isAdministrator: true);

        // The rewritten half of the old "the displaced app is pushed to AuthService as well" test.
        // There is no push any more — the order lives on the permission feature the sidebar already
        // orders by — so the assertion is simply that the sidebar renders the new arrangement.
        var appRows = response.Sections.Single(s => s.Key == "apps").Items;
        Assert.Equal(["Lead Management", "Customer 360"], appRows.Select(r => r.Label));
    }

    [Fact]
    public async Task A_display_order_edit_deactivates_no_capability()
    {
        await RegisterAsync("customer360", "Customer 360", 1, port: 5003);
        var leadId = await RegisterAsync("lead", "Lead Management", 2, port: 5002);
        await GrantEveryAppAViewCapabilityAsync();

        await service.UpdateAsync(leadId, MoveTo(1), actingUserId: null, actorName: null);

        // The other rewritten test, and the sharper of the two. A cosmetic edit that silently revoked
        // another app's permissions is the exact failure the old push path made possible — it loaded
        // the displaced app without its capabilities and pushed an empty set over the real one.
        Assert.All(await db.PermissionFeatureCapabilities.ToListAsync(), c => Assert.True(c.IsActive));
    }

    [Fact]
    public async Task Moving_to_a_free_position_disturbs_nobody()
    {
        await RegisterAsync("customer360", "Customer 360", 1, port: 5003);
        var leadId = await RegisterAsync("lead", "Lead Management", 2, port: 5002);

        await service.UpdateAsync(leadId, MoveTo(9), actingUserId: null, actorName: null);

        Assert.Equal(9, await OrderOfAsync("lead"));
        Assert.Equal(1, await OrderOfAsync("customer360"));
    }

    [Fact]
    public async Task Only_one_app_is_moved_when_several_already_share_a_position()
    {
        // Data from before the swap rule existed: two apps on the same number.
        await RegisterAsync("customer360", "Customer 360", 1, port: 5003);
        await RegisterAsync("archive", "Archive", 1, port: 5004);
        var leadId = await RegisterAsync("lead", "Lead Management", 2, port: 5002);

        await service.UpdateAsync(leadId, MoveTo(1), actingUserId: null, actorName: null);

        // Exactly one of the two occupants moves. Renumbering the rest would be a silent, unrequested
        // rearrangement of positions an admin chose.
        var moved = new[] { await OrderOfAsync("customer360"), await OrderOfAsync("archive") };
        Assert.Contains(2, moved);
        Assert.Contains(1, moved);
    }

    [Fact]
    public async Task Leaving_the_order_unchanged_swaps_nothing()
    {
        await RegisterAsync("customer360", "Customer 360", 1, port: 5003);
        var leadId = await RegisterAsync("lead", "Lead Management", 2, port: 5002);

        await service.UpdateAsync(leadId, MoveTo(2), actingUserId: null, actorName: null);

        Assert.Equal(2, await OrderOfAsync("lead"));
        Assert.Equal(1, await OrderOfAsync("customer360"));
    }

    // ── Status ───────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Disabling_an_app_deactivates_its_permission_feature()
    {
        var id = await RegisterAsync("lead", "Lead Management", 20);

        await service.UpdateStatusAsync(id, "Disabled", null, actingUserId: null, actorName: null);

        // A Disabled app is not merely hidden from the sidebar — its capabilities stop being
        // assignable anywhere in the host, which means the feature itself has to go inactive.
        Assert.False((await db.PermissionFeatures.SingleAsync(f => f.Key == "remote.lead")).IsActive);
    }

    [Fact]
    public async Task Re_enabling_a_disabled_app_makes_its_feature_grantable_again()
    {
        var id = await RegisterAsync("lead", "Lead Management", 20);
        await service.UpdateStatusAsync(id, "Disabled", null, actingUserId: null, actorName: null);

        await service.UpdateStatusAsync(id, "Active", null, actingUserId: null, actorName: null);

        Assert.True((await db.PermissionFeatures.SingleAsync(f => f.Key == "remote.lead")).IsActive);
    }

    [Fact]
    public async Task An_unknown_status_is_a_validation_error_rather_than_a_silent_no_op()
    {
        var id = await RegisterAsync("lead", "Lead Management", 20);

        await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpdateStatusAsync(id, "Paused", null, actingUserId: null, actorName: null));
    }

    [Fact]
    public async Task Deleting_an_app_removes_the_registration_but_only_deactivates_its_feature()
    {
        var id = await RegisterAsync("lead", "Lead Management", 20);

        await service.DeleteAsync(id, actingUserId: null, actorName: null);

        Assert.Empty(await db.RemoteApps.ToListAsync());

        // The feature stays so that every RolePermission and UserPermissionOverride naming it remains
        // intelligible for audit. Deleting it would orphan the record of what an administrator
        // actually granted.
        Assert.False((await db.PermissionFeatures.SingleAsync(f => f.Key == "remote.lead")).IsActive);
    }

    // ── Health feed visibility ───────────────────────────────────────────────────

    [Fact]
    public async Task Health_is_filtered_by_the_same_rule_as_the_sidebar()
    {
        await RegisterAsync("lead", "Lead Management", 20, port: 5002);
        await RegisterAsync("customer360", "Customer 360", 10, port: 5003);

        var entries = await service.GetHealthAsync(
            isAdministrator: false,
            new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "remote.lead:View" });

        // The health panel must never reveal the existence of an app the caller holds nothing on.
        Assert.Equal("lead", Assert.Single(entries).Key);
    }

    [Fact]
    public async Task A_capability_on_a_sub_module_is_enough_to_see_an_app_in_the_health_feed()
    {
        await RegisterAsync("lead", "Lead Management", 20);

        var entries = await service.GetHealthAsync(
            isAdministrator: false,
            new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "remote.lead.dashboard:View" });

        // The clause that is easy to miss: "remote.lead.dashboard:View" does NOT start with
        // "remote.lead:", so a check on the colon form alone would hide the app from every user whose
        // grants are scoped to sub-modules — which is most users.
        Assert.Single(entries);
    }

    [Fact]
    public async Task A_permission_for_a_different_app_does_not_reveal_this_one()
    {
        await RegisterAsync("lead", "Lead Management", 20, port: 5002);

        var entries = await service.GetHealthAsync(
            isAdministrator: false,
            new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "remote.lead-archive:View" });

        // The prefix trap: "remote.lead-archive:View" starts with "remote.lead" but is a different
        // app. Both delimiters in the rule exist to reject exactly this.
        Assert.Empty(entries);
    }

    [Fact]
    public async Task An_administrator_sees_every_app_in_the_health_feed()
    {
        await RegisterAsync("lead", "Lead Management", 20, port: 5002);
        await RegisterAsync("customer360", "Customer 360", 10, port: 5003);

        var entries = await service.GetHealthAsync(isAdministrator: true, new HashSet<string>());

        Assert.Equal(2, entries.Count);
    }

    [Fact]
    public async Task A_disabled_app_is_absent_from_the_health_feed_even_for_an_administrator()
    {
        var id = await RegisterAsync("lead", "Lead Management", 20);
        await service.UpdateStatusAsync(id, "Disabled", null, actingUserId: null, actorName: null);

        var entries = await service.GetHealthAsync(isAdministrator: true, new HashSet<string>());

        Assert.Empty(entries);
    }

    [Fact]
    public async Task The_health_feed_carries_the_display_name_the_shell_labels_permissions_with()
    {
        await RegisterAsync("lead", "Lead Management", 20);

        var entry = Assert.Single(await service.GetHealthAsync(isAdministrator: true, new HashSet<string>()));

        // The host uses this one feed for both the health badge and for turning "remote.lead:View"
        // into readable text on the profile screen. A key-only DTO would need a second endpoint.
        Assert.Equal("Lead Management", entry.DisplayName);
    }

    /// <summary>Gives every registered app one Api capability so the navigation tree will render it.</summary>
    private async Task GrantEveryAppAViewCapabilityAsync()
    {
        foreach (var feature in await db.PermissionFeatures.ToListAsync())
        {
            db.PermissionFeatureCapabilities.Add(new PermissionFeatureCapability
            {
                Id = Guid.NewGuid(),
                FeatureId = feature.Id,
                Key = "View",
                DisplayName = "View",
                Type = CapabilityType.Api,
                IsActive = true,
            });
        }

        db.NavSections.Add(new NavSection { Key = "apps", Label = "Apps", SortOrder = 20, PinToBottom = false });
        await db.SaveChangesAsync();
    }
}
