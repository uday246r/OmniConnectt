using AuthService.Application.DTOs;
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
/// Which modules Checker Assignment offers, and what each entry is called.
/// </summary>
/// <remarks>
/// The list used to be every active feature, which meant it offered Audit Logs, System Logs and the
/// dashboards. Maker-checker holds a change until someone approves it, and a log has no change to
/// hold, so an assignment on one could never fire — while reading, to anyone looking at the list, as
/// though viewing a log required approval. Read access is a permission question and belongs in Roles
/// and Permissions.
///
/// Two things make this worth pinning rather than leaving to the UI. The rule is a set of verb names,
/// because the platform has no read/write axis on a capability to ask instead (CapabilityType is
/// delivery metadata, and its own doc-comment says so) — so a regression here is a silent widening
/// rather than a compile error. And the write paths validate against this same list, which is what
/// stops a read-only module being assigned a checker by an API call that skips the picker.
/// </remarks>
public class CheckerAssignmentAssignableModulesTests : IDisposable
{
    private readonly AuthDbContext db;
    private readonly CheckerAssignmentAppService service;

    public CheckerAssignmentAssignableModulesTests()
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"assignable-{Guid.NewGuid()}")
            .Options;

        db = new AuthDbContext(options);

        var memory = new MemoryPlatformCache(new MemoryCache(new MemoryCacheOptions()));
        var events = new RecordingPublisher();
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

    // ---------------------------------------------------------------- what is offered

    [Fact]
    public async Task A_feature_that_can_only_be_read_is_not_offered_a_checker()
    {
        await SeedFeatureAsync("host.system.audit-logs", "Audit Logs", ["View", "Export"]);

        var modules = await service.GetAssignableModulesAsync();

        Assert.DoesNotContain(modules, m => m.Key == "host.system.audit-logs");
    }

    [Fact]
    public async Task A_dashboard_is_not_offered_either()
    {
        // The plainest case of the rule: there is nothing to create or update on a dashboard.
        await SeedFeatureAsync("host.dashboard", "Dashboard", ["View"]);

        var modules = await service.GetAssignableModulesAsync();

        Assert.Empty(modules);
    }

    [Fact]
    public async Task A_feature_with_even_one_mutating_capability_is_offered()
    {
        await SeedFeatureAsync("host.settings.password-policy", "Setup — Password Policy", ["View", "Edit"]);

        var modules = await service.GetAssignableModulesAsync();

        Assert.Contains(modules, m => m.Key == "host.settings.password-policy");
    }

    [Fact]
    public async Task Approve_and_MaintenanceBypass_do_not_make_a_feature_gateable()
    {
        // Approve is the checker's own act, not a maker's; MaintenanceBypass is a privilege rather
        // than an edit to business data. Neither is something a checker could hold and then release.
        await SeedFeatureAsync("remote.x.audit", "X — Audit", ["View", "Approve", "MaintenanceBypass"]);

        var modules = await service.GetAssignableModulesAsync();

        Assert.Empty(modules);
    }

    [Fact]
    public async Task A_sub_module_is_judged_on_its_own_capabilities_not_its_parents()
    {
        // Lead Management as a whole is gateable; its Audit Logs page is not. Judging a child by its
        // parent would put every remote's log screen straight back on the list.
        var parent = await SeedFeatureAsync("remote.lead", "Lead Management", ["View"]);
        await SeedFeatureAsync("remote.lead.lead", "Leads", ["View", "Create", "Edit", "Delete"], parent.Id);
        await SeedFeatureAsync("remote.lead.auditlog", "Audit Logs", ["View"], parent.Id);

        var modules = await service.GetAssignableModulesAsync();

        Assert.Contains(modules, m => m.Key == "remote.lead.lead");
        Assert.DoesNotContain(modules, m => m.Key == "remote.lead.auditlog");
    }

    [Fact]
    public async Task A_remotes_business_capability_is_not_mistaken_for_a_module_action()
    {
        // Remotes declare charts and KPIs as dotted keys. "chart.create-rate" contains the word
        // create, and must not make a read-only dashboard look gateable.
        await SeedFeatureAsync(
            "remote.products.dashboard", "Dashboard", ["View", "chart.create-rate", "kpi.edits"]);

        var modules = await service.GetAssignableModulesAsync();

        Assert.Empty(modules);
    }

    [Fact]
    public async Task An_inactive_capability_does_not_keep_a_feature_on_the_list()
    {
        var feature = await SeedFeatureAsync("remote.lead.masterdata", "Master Data", ["View"]);
        db.PermissionFeatureCapabilities.Add(new PermissionFeatureCapability
        {
            Id = Guid.NewGuid(),
            FeatureId = feature.Id,
            Key = "Create",
            DisplayName = "Create",
            Type = CapabilityType.Api,
            IsActive = false,
        });
        await db.SaveChangesAsync();

        var modules = await service.GetAssignableModulesAsync();

        Assert.Empty(modules);
    }

    [Fact]
    public async Task Assigning_permissions_to_someone_stays_gateable()
    {
        /*
         * Granting permissions is not its own module: a role's grants are saved by RoleAppService
         * under ApprovalModuleKeys.Roles, and a per-user override by
         * UserAppService.ReplacePermissionOverridesAsync under ApprovalModuleKeys.Users — and those
         * two constants ARE host.settings.roles and host.settings.users. So the only way this change
         * could stop permission changes being approvable is by filtering those two features off the
         * list, which is exactly what this asserts it does not do.
         */
        await SeedFeatureAsync(
            AuthDbSeeder.HostFeatureKeys.SettingsUsers, "Setup — User",
            ["View", "Create", "Edit", "Delete", "Disable"]);
        await SeedFeatureAsync(
            AuthDbSeeder.HostFeatureKeys.SettingsRoles, "Setup — Role",
            ["View", "Create", "Edit", "Delete"]);

        var modules = await service.GetAssignableModulesAsync();

        Assert.Contains(modules, m => m.Key == ApprovalModuleKeys.Users);
        Assert.Contains(modules, m => m.Key == ApprovalModuleKeys.Roles);
    }

    // ---------------------------------------------------------------- what each entry is called

    [Fact]
    public async Task An_entry_names_the_actions_it_gates_in_the_editors_verb_order()
    {
        await SeedFeatureAsync(
            "host.settings.users", "Setup — User", ["View", "Delete", "Create", "Disable", "Edit"]);

        var entry = Assert.Single(await service.GetAssignableModulesAsync());

        // Not the order the catalog happened to return them in: a row must always read
        // "Create / Edit / Disable / Delete", never "Delete / Create / Disable / Edit".
        Assert.Equal(["Create", "Edit", "Disable", "Delete"], entry.Actions);
    }

    [Fact]
    public async Task A_read_capability_is_never_listed_as_an_action()
    {
        // The whole point of the label: a checker assigned here holds changes, not reads.
        await SeedFeatureAsync("remote.lead.lead", "Leads", ["View", "Export", "Create"]);

        var entry = Assert.Single(await service.GetAssignableModulesAsync());

        Assert.Equal(["Create"], entry.Actions);
    }

    [Fact]
    public async Task A_sub_module_is_labelled_under_its_parent()
    {
        var parent = await SeedFeatureAsync("remote.lead", "Lead Management", ["View", "Create"]);
        await SeedFeatureAsync("remote.lead.lead", "Leads", ["View", "Create"], parent.Id);

        var modules = await service.GetAssignableModulesAsync();

        Assert.Contains(modules, m => m.Key == "remote.lead.lead" && m.Label == "Lead Management — Leads");
    }

    // ---------------------------------------------------------------- the write paths honour it

    [Fact]
    public async Task A_read_only_module_cannot_be_assigned_a_checker_by_the_API_either()
    {
        // Narrowing only the picker would leave the rule enforceable by the UI alone.
        await SeedFeatureAsync("host.system.audit-logs", "Audit Logs", ["View"]);
        var checker = await SeedCheckerAsync();

        await Assert.ThrowsAsync<ValidationAppException>(
            () => service.UpsertAsync("host.system.audit-logs", checker.Id, null, null));
    }

    [Fact]
    public async Task Bulk_assignment_refuses_a_read_only_module_too()
    {
        await SeedFeatureAsync("host.system.audit-logs", "Audit Logs", ["View"]);
        await SeedFeatureAsync("host.settings.users", "Setup — User", ["View", "Create"]);
        var checker = await SeedCheckerAsync();

        await Assert.ThrowsAsync<ValidationAppException>(
            () => service.BulkUpsertAsync(
                ["host.settings.users", "host.system.audit-logs"], checker.Id, null, null));
    }

    // ---------------------------------------------------------------- fixture

    private async Task<PermissionFeature> SeedFeatureAsync(
        string key, string displayName, string[] capabilities, Guid? parentId = null)
    {
        var feature = new PermissionFeature
        {
            Id = Guid.NewGuid(),
            Key = key,
            DisplayName = displayName,
            Source = key.StartsWith("remote.") ? PermissionFeatureSource.RemoteApp : PermissionFeatureSource.Host,
            ParentFeatureId = parentId,
            IsActive = true,
        };
        db.PermissionFeatures.Add(feature);

        foreach (var capability in capabilities)
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

    /// <summary>An active user holding Approve, so a refusal in these tests is about the module.</summary>
    private async Task<User> SeedCheckerAsync()
    {
        var approvals = await SeedFeatureAsync(
            AuthDbSeeder.HostFeatureKeys.SystemApprovals, "Approval Center", ["View", "Approve"]);

        var role = new Role { Id = Guid.NewGuid(), Name = "Checkers" };
        db.Roles.Add(role);
        db.RolePermissions.Add(new RolePermission
        {
            Id = Guid.NewGuid(),
            RoleId = role.Id,
            FeatureId = approvals.Id,
            Capability = "Approve",
        });

        var user = new User
        {
            Id = Guid.NewGuid(),
            Name = "Checker",
            Email = "checker@example.com",
            PasswordHash = "x",
            Status = UserStatus.Active,
            RoleId = role.Id,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }
}
