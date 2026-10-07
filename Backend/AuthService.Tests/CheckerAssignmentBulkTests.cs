using AuthService.Application.Events;
using AuthService.Application.Exceptions;
using AuthService.Application.Services;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Caching;
using AuthService.Infrastructure.Seed;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// Bulk checker assignment — the path that decides who is allowed to approve what.
/// </summary>
/// <remarks>
/// Worth testing carefully for two reasons. It is a security-relevant configuration surface: getting
/// it wrong routes approval requests to someone who cannot action them, or silently leaves a module
/// gated with nobody able to clear the queue. And it is a batch operation, so every mistake is
/// multiplied by the size of the batch rather than affecting one row.
/// </remarks>
public class CheckerAssignmentBulkTests : IDisposable
{
    private readonly AuthDbContext db;
    private readonly CheckerAssignmentAppService service;
    private readonly RecordingPublisher events = new();

    public CheckerAssignmentBulkTests()
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"bulk-{Guid.NewGuid()}")
            .Options;

        db = new AuthDbContext(options);

        var memory = new MemoryPlatformCache(new MemoryCache(new MemoryCacheOptions()));
        // No HttpContext here by design: these tests exercise the service outside a request, which
        // AuditLogAppService already supports — ResolveCorrelationId falls back to a fresh Guid and
        // SeedCorrelationId no-ops when HttpContext is null.
        var auditLog = new AuditLogAppService(db, events, new HttpContextAccessor());
        var fine = new FineCapabilityService(db, memory);
        var catalog = new PermissionCatalogAppService(db, memory, fine);
        var claims = new AuthService.Infrastructure.Security.PermissionClaimsBuilder(db);
        var gating = new ApprovalGatingService(db, auditLog, events);

        service = new CheckerAssignmentAppService(db, auditLog, catalog, gating, claims, events);
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    // ---------------------------------------------------------------- input validation

    [Fact]
    public async Task A_null_module_is_a_bad_request_rather_than_a_server_error()
    {
        /*
         * The regression this exists for.
         *
         * The module keys are checked against a HashSet built with StringComparer.Ordinal, and
         * StringComparer.Ordinal.GetHashCode(null) throws — so {"modules":[null]} came out of
         * Contains() as an unhandled ArgumentNullException and a 500. The request DTO validates the
         * list is non-empty but says nothing about its elements, so a malformed body got this far.
         * A caller's malformed input must read as their mistake, not as the server falling over.
         */
        var checker = await SeedCheckerAsync();

        await Assert.ThrowsAsync<ValidationAppException>(
            () => service.BulkUpsertAsync([null!], checker.Id, null, null));
    }

    [Fact]
    public async Task A_blank_module_is_rejected_the_same_way()
    {
        var checker = await SeedCheckerAsync();

        await Assert.ThrowsAsync<ValidationAppException>(
            () => service.BulkUpsertAsync(["   "], checker.Id, null, null));
    }

    [Fact]
    public async Task An_empty_list_is_rejected()
    {
        var checker = await SeedCheckerAsync();

        await Assert.ThrowsAsync<ValidationAppException>(
            () => service.BulkUpsertAsync([], checker.Id, null, null));
    }

    [Fact]
    public async Task Assigning_both_a_user_and_a_role_is_rejected()
    {
        var checker = await SeedCheckerAsync();

        await Assert.ThrowsAsync<ValidationAppException>(
            () => service.BulkUpsertAsync([Module], checker.Id, Guid.NewGuid(), null));
    }

    [Fact]
    public async Task An_unknown_module_fails_the_whole_call_rather_than_being_skipped()
    {
        // All-or-nothing on purpose: a typo'd key silently assigning the other nine modules would
        // leave the operator believing they configured ten.
        var checker = await SeedCheckerAsync();

        await Assert.ThrowsAsync<ValidationAppException>(
            () => service.BulkUpsertAsync([Module, "not.a.real.module"], checker.Id, null, null));

        Assert.Empty(await db.CheckerAssignments.ToListAsync());
    }

    // ---------------------------------------------------------------- what it writes

    [Fact]
    public async Task Every_created_assignment_gets_its_own_audit_row()
    {
        /*
         * Assignments and their audit rows are written under one transaction in production, so a
         * partial failure cannot leave configuration changes with no record of who made them. The
         * InMemory provider has no transactions, so what is asserted here is the outcome that
         * guarantee protects: the counts match.
         */
        var checker = await SeedCheckerAsync();
        await SeedFeatureAsync("host.settings.roles");

        var result = await service.BulkUpsertAsync([Module, "host.settings.roles"], checker.Id, null, null);

        Assert.Equal(2, result.Count);
        Assert.Equal(2, await db.CheckerAssignments.CountAsync());
        Assert.Equal(2, await db.AuditLogs.CountAsync(a => a.Action == "checker_assignment.created"));
    }

    [Fact]
    public async Task Re_assigning_the_same_module_reports_it_as_already_assigned_and_writes_nothing_new()
    {
        // Idempotency has to be honest. Reporting a pre-existing row as newly created is what makes a
        // bulk assign claim to have done more than it did.
        var checker = await SeedCheckerAsync();
        await service.BulkUpsertAsync([Module], checker.Id, null, null);

        var second = await service.BulkUpsertAsync([Module], checker.Id, null, null);

        Assert.True(Assert.Single(second).AlreadyAssigned);
        Assert.Equal(1, await db.CheckerAssignments.CountAsync());
        Assert.Equal(1, await db.AuditLogs.CountAsync(a => a.Action == "checker_assignment.created"));
    }

    // ---------------------------------------------------------------- who it notifies

    [Fact]
    public async Task The_change_is_announced_to_the_checker_assignment_audience_not_the_approvals_one()
    {
        /*
         * The other half of the wrong-group regression. These events were published to
         * approvals.viewers — a wider and different set of people than the ones gated on
         * checker-assignment, so the operators who could actually see this tab were not the ones
         * being told it had changed.
         */
        var checker = await SeedCheckerAsync();

        await service.BulkUpsertAsync([Module], checker.Id, null, null);

        Assert.Contains("checker-assignments", events.CheckerAssignmentEvents);
        Assert.DoesNotContain("checker-assignments", events.ApprovalEvents);
    }

    // ---------------------------------------------------------------- guards that must not be bypassable

    [Fact]
    public async Task A_checker_who_cannot_approve_is_refused_in_bulk_too()
    {
        // Bulk must not be a way around the single-module rules.
        var checker = await SeedCheckerAsync(canApprove: false);

        await Assert.ThrowsAsync<ValidationAppException>(
            () => service.BulkUpsertAsync([Module], checker.Id, null, null));
    }

    [Fact]
    public async Task An_inactive_user_cannot_be_assigned_in_bulk()
    {
        var checker = await SeedCheckerAsync();
        checker.Status = UserStatus.Inactive;
        await db.SaveChangesAsync();

        await Assert.ThrowsAsync<ValidationAppException>(
            () => service.BulkUpsertAsync([Module], checker.Id, null, null));
    }

    // ---------------------------------------------------------------- fixture

    private const string Module = "host.settings.users";

    /// <summary>
    /// A feature with the capabilities a real one declares. The capabilities are not decoration: a
    /// feature offering nothing but reads is no longer assignable a checker, so a fixture that seeds
    /// none would make every assignment in this class fail for the wrong reason.
    /// </summary>
    private async Task<PermissionFeature> SeedFeatureAsync(string key, params string[] capabilities)
    {
        var feature = new PermissionFeature
        {
            Id = Guid.NewGuid(),
            Key = key,
            DisplayName = key,
            Source = PermissionFeatureSource.Host,
            IsActive = true,
        };
        db.PermissionFeatures.Add(feature);

        foreach (var capability in capabilities.Length > 0 ? capabilities : ["View", "Create", "Edit", "Delete"])
        {
            db.PermissionFeatureCapabilities.Add(new PermissionFeatureCapability
            {
                Id = Guid.NewGuid(),
                FeatureId = feature.Id,
                Key = capability,
                DisplayName = capability,
                Type = CapabilityType.Api,
                IsActive = true,
            });
        }

        await db.SaveChangesAsync();
        return feature;
    }

    /// <summary>A user who may be assigned as a checker: active, and holding the Approve capability.</summary>
    private async Task<User> SeedCheckerAsync(bool canApprove = true)
    {
        await SeedFeatureAsync(Module);

        var approvals = await SeedFeatureAsync(AuthDbSeeder.HostFeatureKeys.SystemApprovals, "View");
        db.PermissionFeatureCapabilities.Add(new PermissionFeatureCapability
        {
            Id = Guid.NewGuid(),
            FeatureId = approvals.Id,
            Key = "Approve",
            DisplayName = "Approve",
            Type = CapabilityType.Api,
            IsActive = true,
        });

        var role = new Role { Id = Guid.NewGuid(), Name = "Checkers" };
        db.Roles.Add(role);

        if (canApprove)
        {
            db.RolePermissions.Add(new RolePermission
            {
                Id = Guid.NewGuid(),
                RoleId = role.Id,
                FeatureId = approvals.Id,
                Capability = "Approve",
            });
        }

        var user = new User
        {
            Id = Guid.NewGuid(),
            Name = "Casey Checker",
            Email = "casey@example.com",
            RoleId = role.Id,
            Status = UserStatus.Active,
        };
        db.Users.Add(user);

        await db.SaveChangesAsync();
        return user;
    }

    /// <summary>Records which audience each event was published to, so the routing can be asserted.</summary>
    private sealed class RecordingPublisher : IPlatformEventPublisher
    {
        public List<string> ApprovalEvents { get; } = [];
        public List<string> AuditEvents { get; } = [];
        public List<string> CheckerAssignmentEvents { get; } = [];

        public Task PublishToApprovalViewersAsync(PlatformEvent @event, CancellationToken ct = default)
        {
            ApprovalEvents.Add(@event.Topic);
            return Task.CompletedTask;
        }

        public Task PublishToAuditViewersAsync(PlatformEvent @event, CancellationToken ct = default)
        {
            AuditEvents.Add(@event.Topic);
            return Task.CompletedTask;
        }

        public Task PublishToCheckerAssignmentViewersAsync(PlatformEvent @event, CancellationToken ct = default)
        {
            CheckerAssignmentEvents.Add(@event.Topic);
            return Task.CompletedTask;
        }

        public Task PublishToUsersAsync(IEnumerable<Guid> userIds, PlatformEvent @event, CancellationToken ct = default)
            => Task.CompletedTask;

        public Task PublishBadgeAsync(Guid userId, int pendingCount, CancellationToken ct = default)
            => Task.CompletedTask;

        public void RequestKpiRefresh()
        {
        }
    }
}
