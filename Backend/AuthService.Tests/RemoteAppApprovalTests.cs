using System.Net;
using System.Reflection;
using System.Text;
using System.Text.Json;
using AuthService.Application.DTOs;
using AuthService.Application.Events;
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
/// Maker-checker over remote-app registration, now that the module is replayed in-process rather than
/// by POSTing back to the Module Registry.
/// </summary>
/// <remarks>
/// <para>
/// The trap this file exists for is the one CLAUDE.md names explicitly: a gated mutation is stored as
/// a flat snapshot, and replay reconstructs the real request from that snapshot. Add a field to the
/// request and forget the snapshot, and an approved mutation silently drops it — the checker approves
/// what they were shown, and something else is applied. It fails no test, throws no error, and is
/// invisible until someone notices a setting reverting.
/// </para>
/// <para>
/// So one test compares the two shapes by reflection rather than by eye. It is deliberately strict:
/// it is meant to fail the moment someone extends the request, and the fix is to extend the snapshot
/// alongside it.
/// </para>
/// </remarks>
public class RemoteAppApprovalTests : IDisposable
{
    private readonly AuthDbContext db;
    private readonly MemoryCache memory = new(new MemoryCacheOptions());
    private readonly RemoteAppAppService service;

    public RemoteAppApprovalTests()
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"remote-app-approval-{Guid.NewGuid()}").Options;
        db = new AuthDbContext(options);

        var cache = new MemoryPlatformCache(memory);
        var events = new SilentPublisher();
        var auditLog = new AuditLogAppService(db, events, new HttpContextAccessor());
        var fine = new FineCapabilityService(db, cache);
        var catalog = new PermissionCatalogAppService(db, cache, fine);
        var gating = new ApprovalGatingService(db, auditLog, events);

        service = new RemoteAppAppService(
            db, catalog,
            new RemoteCapabilityDiscoveryClient(new HttpClient(new UnreachableHandler()), NullLogger<RemoteCapabilityDiscoveryClient>.Instance),
            new RemoteManifestClient(new HttpClient(new ManifestHandler()), NullLogger<RemoteManifestClient>.Instance),
            gating, auditLog, NullLogger<RemoteAppAppService>.Instance);
    }

    public void Dispose()
    {
        db.Dispose();
        memory.Dispose();
        GC.SuppressFinalize(this);
    }

    private sealed class ManifestHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent($$"""{"name":"c{{request.RequestUri!.Port}}"}""", Encoding.UTF8, "application/json"),
            });
    }

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

    /// <summary>A maker, a checker, and a checker assignment that gates the Applications module.</summary>
    private async Task<Guid> GateApplicationsModuleAsync()
    {
        var now = DateTimeOffset.UtcNow;

        var maker = new User { Id = Guid.NewGuid(), Name = "Maker", Email = "maker@example.com", PasswordHash = "x", Status = UserStatus.Active, CreatedAt = now, UpdatedAt = now };
        var checker = new User { Id = Guid.NewGuid(), Name = "Checker", Email = "checker@example.com", PasswordHash = "x", Status = UserStatus.Active, CreatedAt = now, UpdatedAt = now };
        db.Users.AddRange(maker, checker);

        db.CheckerAssignments.Add(new CheckerAssignment
        {
            Id = Guid.NewGuid(),
            Module = ApprovalModuleKeys.Applications,
            CheckerUserId = checker.Id,
            CreatedAt = now,
        });

        await db.SaveChangesAsync();
        return maker.Id;
    }

    private static CreateRemoteAppRequest NewApp(string key = "lead", int order = 20) =>
        new(key, "Lead Management", "Layers", "http://localhost:5002/mf-manifest.json", "http://localhost:5046/permissions", order);

    // ── The gate ─────────────────────────────────────────────────────────────────

    [Fact]
    public async Task An_ungated_module_applies_the_registration_immediately()
    {
        var result = await service.CreateAsync(NewApp(), Guid.NewGuid(), "Someone");

        Assert.NotNull(result.Applied);
        Assert.Null(result.Pending);
        Assert.Single(await db.RemoteApps.ToListAsync());
    }

    [Fact]
    public async Task A_gated_registration_is_queued_and_nothing_is_registered_yet()
    {
        var makerId = await GateApplicationsModuleAsync();

        var result = await service.CreateAsync(NewApp(), makerId, "Maker");

        Assert.NotNull(result.Pending);
        Assert.Null(result.Applied);

        // The whole point of the gate: no row, no permission feature, nothing visible to anyone until
        // a checker decides.
        Assert.Empty(await db.RemoteApps.ToListAsync());
        Assert.Empty(await db.PermissionFeatures.Where(f => f.Key == "remote.lead").ToListAsync());
    }

    [Fact]
    public async Task A_super_admin_registration_bypasses_the_gate_entirely()
    {
        var makerId = await GateApplicationsModuleAsync();

        var result = await service.CreateAsync(NewApp(), makerId, "Maker", bypassApproval: true);

        Assert.NotNull(result.Applied);
        Assert.Single(await db.RemoteApps.ToListAsync());
    }

    [Fact]
    public async Task A_pending_registration_blocks_a_second_registration_of_the_same_key()
    {
        var makerId = await GateApplicationsModuleAsync();
        await service.CreateAsync(NewApp(), makerId, "Maker");

        var request = await db.ApprovalRequests.SingleAsync();

        // A Create has no entity id, so the app key is what dedupes it. Without an explicit key the
        // guarantee is inert: it falls back to a null entity id, and Postgres treats NULLs as
        // distinct — so two makers could each queue a registration for the same key.
        Assert.Equal("remoteapp:lead", request.EntityKey);
    }

    [Fact]
    public async Task A_gated_delete_shows_the_checker_what_is_being_removed()
    {
        var created = await service.CreateAsync(NewApp(), Guid.NewGuid(), "Someone");
        var makerId = await GateApplicationsModuleAsync();

        await service.DeleteAsync(created.Applied!.Id, makerId, "Maker");

        var request = await db.ApprovalRequests.SingleAsync(r => r.Action == ApprovalActionKeys.Delete);
        var snapshot = JsonSerializer.Deserialize<RemoteAppSnapshotDto>(request.NewDataJson)!;

        // Delete used to store "{}", so the Approval Centre showed a checker nothing at all about the
        // app they were being asked to remove. Both sides now carry the stored record.
        Assert.Equal("lead", snapshot.Key);
        Assert.Equal("Lead Management", snapshot.DisplayName);
        Assert.Equal(request.OldDataJson, request.NewDataJson);
    }

    [Fact]
    public async Task A_gated_status_change_carries_its_maintenance_message_through_the_snapshot()
    {
        var created = await service.CreateAsync(NewApp(), Guid.NewGuid(), "Someone");
        var makerId = await GateApplicationsModuleAsync();

        await service.UpdateStatusAsync(
            created.Applied!.Id, "Maintenance", "Upgrading until 18:00 UTC.", makerId, "Maker");

        var request = await db.ApprovalRequests.SingleAsync(r => r.Action == ApprovalActionKeys.Enable);
        var snapshot = JsonSerializer.Deserialize<RemoteAppSnapshotDto>(request.NewDataJson)!;

        Assert.Equal("Maintenance", snapshot.Status);
        Assert.Equal("Upgrading until 18:00 UTC.", snapshot.MaintenanceMessage);
    }

    [Fact]
    public async Task A_gated_edit_stores_both_sides_of_the_diff_in_the_same_shape()
    {
        var created = await service.CreateAsync(NewApp(), Guid.NewGuid(), "Someone");
        var makerId = await GateApplicationsModuleAsync();

        await service.UpdateAsync(
            created.Applied!.Id,
            new UpdateRemoteAppRequest("Leads", "Box", "http://localhost:5002/mf-manifest.json", null, 5),
            makerId, "Maker");

        var request = await db.ApprovalRequests.SingleAsync(r => r.Action == ApprovalActionKeys.Update);
        var before = JsonSerializer.Deserialize<RemoteAppSnapshotDto>(request.OldDataJson!)!;
        var after = JsonSerializer.Deserialize<RemoteAppSnapshotDto>(request.NewDataJson)!;

        // One shape on both sides, so the diff pane compares like with like. The previous arrangement
        // — an anonymous object on one side and the request DTO on the other — agreed only by
        // coincidence, and any new field broke the agreement silently.
        Assert.Equal("Lead Management", before.DisplayName);
        Assert.Equal("Leads", after.DisplayName);
        Assert.Equal(20, before.SidebarOrder);
        Assert.Equal(5, after.SidebarOrder);
    }

    // ── The snapshot must not fall behind the requests it reconstructs ───────────

    [Fact]
    public void The_snapshot_carries_every_field_a_registration_request_needs_to_be_rebuilt()
    {
        var snapshotFields = Fields<RemoteAppSnapshotDto>();

        // Replay rebuilds a CreateRemoteAppRequest from the snapshot alone. Anything the request needs
        // and the snapshot lacks is a field an approved registration silently drops.
        var missing = Fields<CreateRemoteAppRequest>().Except(snapshotFields).ToList();

        Assert.True(
            missing.Count == 0,
            $"RemoteAppSnapshotDto is missing {string.Join(", ", missing)}. Add them to the snapshot, to "
            + "both places that build it, and to the replay reconstruction together — or an approved "
            + "registration will apply without them.");
    }

    [Fact]
    public void The_snapshot_carries_every_field_an_edit_request_needs_to_be_rebuilt()
    {
        var missing = Fields<UpdateRemoteAppRequest>().Except(Fields<RemoteAppSnapshotDto>()).ToList();

        Assert.True(
            missing.Count == 0,
            $"RemoteAppSnapshotDto is missing {string.Join(", ", missing)}. See the sibling test for why.");
    }

    [Fact]
    public void The_snapshot_carries_every_field_a_status_change_needs_to_be_rebuilt()
    {
        var missing = Fields<UpdateRemoteAppStatusRequest>().Except(Fields<RemoteAppSnapshotDto>()).ToList();

        Assert.True(missing.Count == 0, $"RemoteAppSnapshotDto is missing {string.Join(", ", missing)}.");
    }

    [Fact]
    public void The_snapshot_does_not_carry_health()
    {
        var fields = Fields<RemoteAppSnapshotDto>();

        // Health is rewritten on a probe interval, so including it would make the diff pane report a
        // change nobody requested every time a sweep landed between submission and approval.
        Assert.DoesNotContain("Health", fields);
        Assert.DoesNotContain("LastHealthCheckAt", fields);
        Assert.DoesNotContain("LastHealthError", fields);
    }

    private static HashSet<string> Fields<T>() =>
        typeof(T).GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Select(p => p.Name)
            .ToHashSet(StringComparer.Ordinal);
}
