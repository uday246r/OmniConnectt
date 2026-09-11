using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Caching;
using AuthService.Infrastructure.Seed;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// The startup report that makes the claims-builder fix visible.
/// </summary>
/// <remarks>
/// Tightening the claims builder silently takes a permission away from anyone holding a grant for a
/// capability no app declares any more. That is the correct outcome, but an operator has to be able
/// to see it happen rather than wait for a user to report that a button vanished.
/// </remarks>
public class StaleGrantReportTests : IDisposable
{
    private readonly AuthDbContext db;
    private readonly PermissionCatalogAppService catalog;
    private readonly FineCapabilityService fine;
    private readonly CapturingLogger logger = new();

    public StaleGrantReportTests()
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"stale-{Guid.NewGuid()}")
            .Options;

        db = new AuthDbContext(options);

        var memory = new MemoryPlatformCache(new MemoryCache(new MemoryCacheOptions()));
        fine = new FineCapabilityService(db, memory);
        catalog = new PermissionCatalogAppService(db, memory, fine);
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public async Task A_healthy_catalog_produces_no_warnings_at_all()
    {
        // Every boot after the first runs this. It must be silent when there is nothing wrong, or the
        // warning stops meaning anything.
        await SeedGrantAsync("View", declaredAfterwards: "View");

        await StaleGrantReport.RunAsync(db, logger);

        Assert.Empty(logger.Warnings);
    }

    [Fact]
    public async Task A_grant_whose_capability_was_withdrawn_is_named_along_with_who_holds_it()
    {
        await SeedGrantAsync("Export", declaredAfterwards: "View");

        await StaleGrantReport.RunAsync(db, logger);

        Assert.Contains(logger.Warnings, w => w.Contains("remote.lead:Export"));
        Assert.Contains(logger.Warnings, w => w.Contains("Tester"));
    }

    [Fact]
    public async Task A_business_capability_is_not_reported_merely_for_being_absent_from_the_token()
    {
        // A Widget grant is deliberately not minted, and saying so on every boot would bury the real
        // finding under noise. The report is about grants naming something that no longer exists.
        var feature = await SyncAsync(
            new UpsertCapabilityRequest("kpi.total-leads", "Total Leads", 100, Type: "Widget"));
        await GrantAsync(feature, "kpi.total-leads");

        await StaleGrantReport.RunAsync(db, logger);

        Assert.Empty(logger.Warnings);
    }

    private async Task<PermissionFeature> SyncAsync(params UpsertCapabilityRequest[] caps)
    {
        await catalog.UpsertRemoteAppFeatureAsync("remote.lead", "Lead Management", 10, caps);
        return await db.PermissionFeatures.Include(f => f.Capabilities).FirstAsync(f => f.Key == "remote.lead");
    }

    private async Task SeedGrantAsync(string granted, string declaredAfterwards)
    {
        var feature = await SyncAsync(
            new UpsertCapabilityRequest("View", "View"),
            new UpsertCapabilityRequest("Export", "Export"));

        await GrantAsync(feature, granted);

        // The remote stops declaring everything except one capability.
        await SyncAsync(new UpsertCapabilityRequest(declaredAfterwards, declaredAfterwards));
    }

    private async Task GrantAsync(PermissionFeature feature, string capability)
    {
        var role = new Role { Id = Guid.NewGuid(), Name = "Tester" };
        db.Roles.Add(role);
        db.RolePermissions.Add(new RolePermission
        {
            Id = Guid.NewGuid(),
            RoleId = role.Id,
            FeatureId = feature.Id,
            Capability = capability,
        });
        await db.SaveChangesAsync();
    }

    /// <summary>Keeps the formatted warning lines so the test can assert on what an operator would read.</summary>
    private sealed class CapturingLogger : ILogger
    {
        public List<string> Warnings { get; } = [];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (logLevel >= LogLevel.Warning)
            {
                Warnings.Add(formatter(state, exception));
            }
        }
    }
}
