using System.Net;
using ModuleRegistry.Application.DTOs;
using ModuleRegistry.Application.Services;
using ModuleRegistry.Domain.Entities;
using ModuleRegistry.Domain.Enums;
using ModuleRegistry.Infrastructure;
using ModuleRegistry.Options;
using MsOptions = Microsoft.Extensions.Options.Options;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace ModuleRegistry.Tests;

/// <summary>
/// Sidebar ordering, and what an ordering edit is allowed to disturb.
/// </summary>
/// <remarks>
/// Ordering is a plain int with no unique constraint, so moving an app onto a position another app
/// holds swaps the two rather than leaving both there for a tiebreaker to resolve arbitrarily. The
/// dangerous part is not the swap itself but its blast radius: the displaced app has to be pushed to
/// AuthService too, because AuthService is what the sidebar is actually rendered from — and that push
/// carries the app's capabilities, so getting it wrong turns a cosmetic edit into a permission change.
/// </remarks>
public class RemoteAppOrderingTests : IDisposable
{
    private readonly ModuleRegistryDbContext db;
    private readonly RecordingHandler authCalls = new();
    private readonly RemoteAppAppService service;

    public RemoteAppOrderingTests()
    {
        var options = new DbContextOptionsBuilder<ModuleRegistryDbContext>()
            .UseInMemoryDatabase($"ordering-{Guid.NewGuid()}")
            .Options;

        db = new ModuleRegistryDbContext(options);

        var authClient = new AuthServiceClient(
            new HttpClient(authCalls),
            MsOptions.Create(new AuthIntegrationOptions { BaseUrl = "http://auth.test", InternalApiKey = "k" }),
            NullLogger<AuthServiceClient>.Instance,
            new HttpContextAccessor());

        var manifestClient = new RemoteManifestClient(
            new HttpClient(new UnreachableHandler()),
            NullLogger<RemoteManifestClient>.Instance);

        service = new RemoteAppAppService(
            db, authClient, manifestClient,
            NullLogger<RemoteAppAppService>.Instance,
            MsOptions.Create(new SelfOptions()));
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public async Task Moving_an_app_onto_an_occupied_position_swaps_the_two()
    {
        // One edit expresses the whole intent. Before this, putting Lead first meant editing Lead and
        // then separately editing whatever already held position 1.
        var lead = await SeedAppAsync("lead", "Lead Management", order: 2);
        var c360 = await SeedAppAsync("customer360", "Customer 360", order: 1);

        await service.UpdateAsync(lead.Id, UpdateTo(lead, sidebarOrder: 1), actingUserId: null, actorName: null);

        Assert.Equal(1, (await Reload(lead)).SidebarOrder);
        Assert.Equal(2, (await Reload(c360)).SidebarOrder);
    }

    [Fact]
    public async Task The_displaced_app_is_pushed_to_AuthService_as_well()
    {
        /*
         * AuthService — not this service — is what GET /api/navigation renders the sidebar from. Saving
         * the displaced app's new position only to this service's own table left the two disagreeing,
         * and the sidebar kept showing the old arrangement until that other app happened to be edited
         * or resynced for some unrelated reason.
         */
        var lead = await SeedAppAsync("lead", "Lead Management", order: 2);
        await SeedAppAsync("customer360", "Customer 360", order: 1);

        await service.UpdateAsync(lead.Id, UpdateTo(lead, sidebarOrder: 1), actingUserId: null, actorName: null);

        Assert.Contains(authCalls.UpsertedFeatureKeys, k => k == "remote.lead");
        Assert.Contains(authCalls.UpsertedFeatureKeys, k => k == "remote.customer360");
    }

    [Fact]
    public async Task The_displaced_app_keeps_its_capabilities_through_the_push()
    {
        /*
         * The defect this is really guarding.
         *
         * The displaced app is loaded to have its order changed and then pushed. Load it without its
         * Capabilities and the push serialises an empty set — so a change to display order silently
         * withdraws that app's entire permission surface from the catalog. Cosmetic edit, real
         * authorization consequence, and nothing anywhere would report it.
         */
        var lead = await SeedAppAsync("lead", "Lead Management", order: 2);
        await SeedAppAsync("customer360", "Customer 360", order: 1, capabilities: ["View", "Export"]);

        await service.UpdateAsync(lead.Id, UpdateTo(lead, sidebarOrder: 1), actingUserId: null, actorName: null);

        var pushed = authCalls.PayloadFor("remote.customer360");
        Assert.Contains("View", pushed);
        Assert.Contains("Export", pushed);
    }

    [Fact]
    public async Task Moving_to_a_free_position_disturbs_nobody()
    {
        var lead = await SeedAppAsync("lead", "Lead Management", order: 1);
        var c360 = await SeedAppAsync("customer360", "Customer 360", order: 2);

        await service.UpdateAsync(lead.Id, UpdateTo(lead, sidebarOrder: 9), actingUserId: null, actorName: null);

        Assert.Equal(9, (await Reload(lead)).SidebarOrder);
        Assert.Equal(2, (await Reload(c360)).SidebarOrder);
    }

    [Fact]
    public async Task Only_one_app_is_moved_when_several_already_share_a_position()
    {
        // Data from before the swap rule can legitimately have duplicates. Renumbering the rest to
        // "tidy up" would move apps the operator never touched.
        var lead = await SeedAppAsync("lead", "Lead Management", order: 5);
        var a = await SeedAppAsync("alpha", "Alpha", order: 1);
        var b = await SeedAppAsync("bravo", "Bravo", order: 1);

        await service.UpdateAsync(lead.Id, UpdateTo(lead, sidebarOrder: 1), actingUserId: null, actorName: null);

        var moved = (await Reload(a)).SidebarOrder == 5 ? 1 : 0;
        moved += (await Reload(b)).SidebarOrder == 5 ? 1 : 0;
        Assert.Equal(1, moved);
    }

    [Fact]
    public async Task Leaving_the_order_unchanged_swaps_nothing()
    {
        var lead = await SeedAppAsync("lead", "Lead Management", order: 1);
        var c360 = await SeedAppAsync("customer360", "Customer 360", order: 1);

        await service.UpdateAsync(lead.Id, UpdateTo(lead, sidebarOrder: 1), actingUserId: null, actorName: null);

        // The other app held the same number already; an edit that does not move anything must not
        // start shuffling rows.
        Assert.Equal(1, (await Reload(c360)).SidebarOrder);
    }

    // ---------------------------------------------------------------- fixture

    private async Task<RemoteApp> Reload(RemoteApp app) =>
        await db.RemoteApps.AsNoTracking().FirstAsync(a => a.Id == app.Id);

    private static UpdateRemoteAppRequest UpdateTo(RemoteApp app, int sidebarOrder) =>
        new(app.DisplayName, app.IconKey, app.ManifestUrl, app.PermissionsSourceUrl, sidebarOrder);

    private async Task<RemoteApp> SeedAppAsync(
        string key, string displayName, int order, string[]? capabilities = null)
    {
        var app = new RemoteApp
        {
            Id = Guid.NewGuid(),
            Key = key,
            DisplayName = displayName,
            ManifestUrl = $"http://{key}.test/mf-manifest.json",
            ContainerName = $"{key}_mf",
            SidebarOrder = order,
            Status = RemoteAppStatus.Active,
            PermissionFeatureKey = $"remote.{key}",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };

        foreach (var (capability, index) in (capabilities ?? []).Select((c, i) => (c, i)))
        {
            app.Capabilities.Add(new RemoteAppCapability
            {
                Id = Guid.NewGuid(),
                RemoteAppId = app.Id,
                ModuleKey = string.Empty,
                ModuleDisplayName = string.Empty,
                Key = capability,
                DisplayName = capability,
                SortOrder = index * 10,
            });
        }

        db.RemoteApps.Add(app);
        await db.SaveChangesAsync();
        return app;
    }

    /// <summary>Captures what was pushed to AuthService rather than sending it anywhere.</summary>
    private sealed class RecordingHandler : HttpMessageHandler
    {
        private readonly List<(string Path, string Body)> calls = [];

        public IReadOnlyList<string> UpsertedFeatureKeys => calls
            .Where(c => c.Path.Contains("permission-features/upsert", StringComparison.Ordinal))
            .Select(c => ExtractKey(c.Body))
            .Where(k => k is not null)
            .Select(k => k!)
            .ToList();

        /// <summary>The raw pushed body for one feature, so its capability set can be asserted on.</summary>
        public string PayloadFor(string featureKey) => calls
            .Select(c => c.Body)
            .FirstOrDefault(b => ExtractKey(b) == featureKey) ?? string.Empty;

        private static string? ExtractKey(string body)
        {
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(body);
                return doc.RootElement.TryGetProperty("key", out var k) ? k.GetString() : null;
            }
            catch (System.Text.Json.JsonException)
            {
                return null;
            }
        }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = request.Content is null ? string.Empty : await request.Content.ReadAsStringAsync(ct);
            calls.Add((request.RequestUri?.AbsolutePath ?? string.Empty, body));
            return new HttpResponseMessage(HttpStatusCode.NoContent);
        }
    }

    /// <summary>Manifest probing is not what these tests are about; every probe simply fails.</summary>
    private sealed class UnreachableHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            => throw new HttpRequestException("not probed in this test");
    }
}
