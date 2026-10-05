using System.Net;
using System.Text;
using AuthService.Application.DTOs;
using AuthService.Application.Events;
using AuthService.Application.Exceptions;
using AuthService.Application.Services;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Caching;
using AuthService.Infrastructure.Remotes;
using AuthService.Options;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using MsOptions = Microsoft.Extensions.Options.Options;

namespace AuthService.Tests;

/// <summary>
/// Shipping a remote by moving a pointer: register a published build, promote it, roll it back.
/// </summary>
/// <remarks>
/// This is the mechanism that lets one remote change without the host or any other remote going down,
/// so its failure modes are the ones that would put broken or foreign code in front of users: a build
/// that is not actually there, a folder holding a different app, a remote the live host cannot run, a
/// version re-published with different content, and a promotion that does not reach open tabs. Each
/// has a test. The web server is a stub that serves manifests from a dictionary of paths.
/// </remarks>
public class ReleaseAppServiceTests : IDisposable
{
    private readonly AuthDbContext db;
    private readonly MemoryCache memory = new(new MemoryCacheOptions());
    private readonly WebServer web = new();
    private readonly CountingPublisher events = new();
    private readonly ReleaseAppService releases;

    public ReleaseAppServiceTests()
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"releases-{Guid.NewGuid()}").Options;
        db = new AuthDbContext(options);

        var cache = new MemoryPlatformCache(memory);
        var auditLog = new AuditLogAppService(db, events, new HttpContextAccessor());
        var catalog = new PermissionCatalogAppService(db, cache, new FineCapabilityService(db, cache));
        var appsOptions = MsOptions.Create(new RemoteAppsOptions { InternalBaseUrl = "http://web-internal:8080", AllowAbsoluteManifestUrls = false });
        var manifests = new RemoteManifestClient(new HttpClient(web), NullLogger<RemoteManifestClient>.Instance, appsOptions);

        var remoteApps = new RemoteAppAppService(
            db, catalog,
            new RemoteCapabilityDiscoveryClient(new HttpClient(web), NullLogger<RemoteCapabilityDiscoveryClient>.Instance),
            manifests, new ApprovalGatingService(db, auditLog, events), auditLog,
            NullLogger<RemoteAppAppService>.Instance, appsOptions, events);

        releases = new ReleaseAppService(db, remoteApps, manifests, auditLog, NullLogger<ReleaseAppService>.Instance);
    }

    public void Dispose()
    {
        db.Dispose();
        memory.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <summary>The platform's internal web server: a manifest per published path, 404 otherwise.</summary>
    private sealed class WebServer : HttpMessageHandler
    {
        private readonly Dictionary<string, string> files = new(StringComparer.Ordinal);
        public List<string> Requested { get; } = [];

        public void Publish(string key, string version, string container, string? requiredHostBridge = "^1.0.0")
        {
            var omni = requiredHostBridge is null ? "" : $$""","omniconnect":{"requiredHostBridge":"{{requiredHostBridge}}"}""";
            files[$"/modules/{key}/{version}/mf-manifest.json"] =
                $$$"""{"name":"{{{container}}}","metaData":{"buildInfo":{"buildVersion":"{{{version}}}"}{{{omni}}}}}""";
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requested.Add(request.RequestUri!.ToString());
            return Task.FromResult(files.TryGetValue(request.RequestUri!.AbsolutePath, out var body)
                ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") }
                : new HttpResponseMessage(HttpStatusCode.NotFound));
        }
    }

    private sealed class CountingPublisher : IPlatformEventPublisher
    {
        public int NavigationChanges { get; private set; }
        public Task PublishToApprovalViewersAsync(PlatformEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task PublishToAuditViewersAsync(PlatformEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task PublishToCheckerAssignmentViewersAsync(PlatformEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task PublishToUsersAsync(IEnumerable<Guid> userIds, PlatformEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task PublishBadgeAsync(Guid userId, int pendingCount, CancellationToken ct = default) => Task.CompletedTask;
        public void RequestKpiRefresh() { }
        public Task PublishNavigationChangedAsync(CancellationToken ct = default) { NavigationChanges++; return Task.CompletedTask; }
    }

    private Task<ReleaseRecordDto> Register(string key, string version, string? checksum = null, string? displayName = "Lead Management") =>
        releases.RegisterAsync(new RegisterReleaseRequest(key, version, checksum, "2026.10.05+abc", DisplayName: displayName));

    private async Task InstallLeadAsync()
    {
        web.Publish("lead", "1.0.0", "lead_mf");
        await Register("lead", "1.0.0");
    }

    private Task<RemoteApp> Lead() => db.RemoteApps.AsNoTracking().SingleAsync(a => a.Key == "lead");

    [Fact]
    public async Task The_first_build_of_an_app_that_does_not_exist_yet_installs_it_and_goes_live()
    {
        await InstallLeadAsync();

        var lead = await Lead();
        Assert.Equal("/modules/lead/1.0.0/mf-manifest.json", lead.ManifestUrl);
        Assert.Equal("lead_mf", lead.ContainerName);
        Assert.Equal("Live", (await releases.ListAsync("lead")).Single().Status);
        Assert.Contains("http://web-internal:8080/modules/lead/1.0.0/mf-manifest.json", web.Requested);
    }

    [Fact]
    public async Task Registering_a_later_build_changes_nothing_users_load_until_it_is_promoted()
    {
        await InstallLeadAsync();
        web.Publish("lead", "1.0.1", "lead_mf");

        var staged = await Register("lead", "1.0.1");

        Assert.Equal("Staged", staged.Status);
        Assert.Equal("/modules/lead/1.0.0/mf-manifest.json", (await Lead()).ManifestUrl);
    }

    [Fact]
    public async Task Promoting_moves_the_pointer_supersedes_the_old_build_and_tells_open_tabs()
    {
        await InstallLeadAsync();
        web.Publish("lead", "1.0.1", "lead_mf");
        await Register("lead", "1.0.1");
        var before = events.NavigationChanges;

        await releases.PromoteAsync("lead", "1.0.1", "release-agent");

        Assert.Equal("/modules/lead/1.0.1/mf-manifest.json", (await Lead()).ManifestUrl);
        var history = await releases.ListAsync("lead");
        Assert.Equal("Live", history.Single(r => r.Version == "1.0.1").Status);
        Assert.Equal("Superseded", history.Single(r => r.Version == "1.0.0").Status);
        Assert.True(events.NavigationChanges > before);
    }

    [Fact]
    public async Task Rolling_back_puts_the_previous_build_back_in_front_of_users()
    {
        await InstallLeadAsync();
        web.Publish("lead", "1.0.1", "lead_mf");
        await Register("lead", "1.0.1");
        await releases.PromoteAsync("lead", "1.0.1", "release-agent");

        var restored = await releases.RollbackAsync("lead", "release-agent");

        Assert.Equal("1.0.0", restored.Version);
        Assert.Equal("/modules/lead/1.0.0/mf-manifest.json", (await Lead()).ManifestUrl);
    }

    [Fact]
    public async Task A_build_that_is_not_on_the_web_server_cannot_be_registered()
    {
        var error = await Assert.ThrowsAsync<ValidationAppException>(() => Register("lead", "9.9.9"));

        Assert.Contains("not found on the web server", error.Message);
    }

    [Fact]
    public async Task A_folder_holding_a_different_apps_build_is_never_promoted()
    {
        await InstallLeadAsync();
        // Someone published Customer 360's build into Lead's 1.0.1 folder.
        web.Publish("lead", "1.0.1", "customer360_mf");
        await Register("lead", "1.0.1");

        await Assert.ThrowsAsync<ConflictAppException>(() => releases.PromoteAsync("lead", "1.0.1", "release-agent"));
        Assert.Equal("/modules/lead/1.0.0/mf-manifest.json", (await Lead()).ManifestUrl);
    }

    [Fact]
    public async Task A_version_cannot_be_republished_with_different_content()
    {
        web.Publish("lead", "1.0.0", "lead_mf");
        await Register("lead", "1.0.0", checksum: "aaa");

        await Assert.ThrowsAsync<ConflictAppException>(() => Register("lead", "1.0.0", checksum: "bbb"));
        Assert.Equal("1.0.0", (await Register("lead", "1.0.0", checksum: "aaa")).Version);
    }

    [Fact]
    public async Task A_remote_the_live_host_cannot_run_is_refused_and_users_stay_on_the_old_build()
    {
        await releases.RegisterAsync(new RegisterReleaseRequest("host", "3.2.0", BridgeVersion: "1.4.0"));
        await releases.PromoteAsync("host", "3.2.0", "release-agent");
        await InstallLeadAsync();
        web.Publish("lead", "2.0.0", "lead_mf", requiredHostBridge: "^2.0.0");
        await Register("lead", "2.0.0");

        var error = await Assert.ThrowsAsync<ConflictAppException>(() => releases.PromoteAsync("lead", "2.0.0", "release-agent"));

        Assert.Contains("^2.0.0", error.Message);
        Assert.Equal("/modules/lead/1.0.0/mf-manifest.json", (await Lead()).ManifestUrl);
    }

    [Fact]
    public async Task A_host_that_would_break_a_live_remote_is_refused()
    {
        await InstallLeadAsync();
        await releases.RegisterAsync(new RegisterReleaseRequest("host", "4.0.0", BridgeVersion: "2.0.0"));

        var error = await Assert.ThrowsAsync<ConflictAppException>(() => releases.PromoteAsync("host", "4.0.0", "release-agent"));

        Assert.Contains("lead 1.0.0", error.Message);
    }

    [Fact]
    public async Task A_host_build_must_say_which_bridge_it_provides()
    {
        await Assert.ThrowsAsync<ValidationAppException>(() =>
            releases.RegisterAsync(new RegisterReleaseRequest("host", "3.2.0")));
    }

    [Fact]
    public async Task There_is_nothing_to_roll_back_to_before_a_second_build_has_been_live()
    {
        await InstallLeadAsync();

        await Assert.ThrowsAsync<NotFoundAppException>(() => releases.RollbackAsync("lead", "release-agent"));
    }
}
