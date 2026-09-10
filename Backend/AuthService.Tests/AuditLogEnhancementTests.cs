using System.Security.Claims;
using AuthService.Application.DTOs;
using AuthService.Application.Events;
using AuthService.Application.Services;
using AuthService.Controllers;
using AuthService.Domain.Entities;
using AuthService.Infrastructure;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace AuthService.Tests;

public class AuditLogEnhancementTests : IDisposable
{
    private readonly AuthDbContext db;
    private readonly AuditLogAppService service;
    private readonly StubPlatformEventPublisher eventPublisher;

    public AuditLogEnhancementTests()
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"auditlogs-{Guid.NewGuid()}")
            .Options;
        db = new AuthDbContext(options);

        var httpContextAccessor = new HttpContextAccessor();
        eventPublisher = new StubPlatformEventPublisher();
        service = new AuditLogAppService(db, eventPublisher, httpContextAccessor);
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public async Task Task2_ExportCsvAsync_AppliesAllFiltersAndTimeline()
    {
        var now = DateTimeOffset.UtcNow;
        var userA = Guid.NewGuid();
        var userB = Guid.NewGuid();

        // 1. Log within timeline for userA
        await service.WriteAsync("AuthService", userA, "User Alpha", "lead.created", "Lead", "101", null, sourceIp: "127.0.0.1", correlationId: "corr-1");

        // 2. Log for userB
        await service.WriteAsync("AuthService", userB, "User Beta", "lead.created", "Lead", "102", null, sourceIp: "127.0.0.1", correlationId: "corr-2");

        // Export with filter for userA
        var csv = await service.ExportCsvAsync(
            actorName: "User Alpha",
            correlationId: "corr-1"
        );

        Assert.Contains("User Alpha", csv);
        Assert.DoesNotContain("User Beta", csv);
        Assert.Contains("lead.created", csv);
    }

    [Fact]
    public async Task Task3_ExportCsvAsync_HidesCorrelationIdFromCsvHeaderAndRows()
    {
        await service.WriteAsync("AuthService", Guid.NewGuid(), "Tester", "user.created", "User", "1", null, correlationId: "internal-secret-correlation-guid");

        var csv = await service.ExportCsvAsync();

        // CSV Header must not contain CorrelationId
        var firstLine = csv.Split('\n')[0];
        Assert.DoesNotContain("CorrelationId", firstLine);

        // Data rows must not contain the raw correlation GUID
        Assert.DoesNotContain("internal-secret-correlation-guid", csv);
    }

    [Fact]
    public async Task Task4_UserActivityFields_AreWrittenAndQueriedSuccessfully()
    {
        var userId = Guid.NewGuid();
        await service.WriteAsync(
            serviceName: "AuthService",
            actorUserId: userId,
            actorName: "John Doe",
            action: "page.viewed",
            entityType: null,
            entityId: null,
            details: null,
            sourceIp: "127.0.0.1",
            sourceApplication: "Lead Management",
            module: "Leads",
            page: "create-lead",
            actionCategory: "Navigation"
        );

        var stored = await db.AuditLogs.FirstOrDefaultAsync();
        Assert.NotNull(stored);
        Assert.Equal("Lead Management", stored.SourceApplication);
        Assert.Equal("Remote", stored.HostOrRemote);
        Assert.Equal("Lead Management", stored.RemoteName);
        Assert.Equal("Leads", stored.Module);
        Assert.Equal("create-lead", stored.Page);
        Assert.Equal("Navigation", stored.ActionCategory);

        // Verify ListAsync query filter by sourceApplication
        var result = await service.ListAsync(1, 10, null, null, null, null, null, null, sourceApplication: "Lead Management");
        Assert.Equal(1, result.Total);
        Assert.Equal("Lead Management", result.Items[0].SourceApplication);
        Assert.Equal("Navigation", result.Items[0].ActionCategory);
    }

    [Fact]
    public async Task Task4_UserActivityController_RecordsNavigationEventsFromContext()
    {
        var controller = new UserActivityController(service);
        var userId = Guid.NewGuid();

        var httpContext = new DefaultHttpContext();
        httpContext.User = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim("sub", userId.ToString()),
            new Claim("name", "Jane Doe"),
        }, "TestAuth"));
        httpContext.Connection.RemoteIpAddress = System.Net.IPAddress.Parse("127.0.0.1");

        controller.ControllerContext = new ControllerContext
        {
            HttpContext = httpContext,
        };

        var response = await controller.Record(new UserActivityController.ActivityEvent(
            Page: "dashboard",
            Module: "Dashboard",
            SourceApplication: "Host"
        ), CancellationToken.None);

        Assert.IsType<NoContentResult>(response);

        var logged = await db.AuditLogs.FirstOrDefaultAsync();
        Assert.NotNull(logged);
        Assert.Equal(userId, logged.ActorUserId);
        Assert.Equal("Jane Doe", logged.ActorName);
        Assert.Equal("page.viewed", logged.Action);
        Assert.Equal("Host", logged.SourceApplication);
        Assert.Equal("Dashboard", logged.Module);
        Assert.Equal("dashboard", logged.Page);
        Assert.Equal("Navigation", logged.ActionCategory);
    }

    private class StubPlatformEventPublisher : IPlatformEventPublisher
    {
        public Task PublishToApprovalViewersAsync(PlatformEvent @event, CancellationToken ct = default) => Task.CompletedTask;
        public Task PublishToAuditViewersAsync(PlatformEvent platformEvent, CancellationToken ct = default) => Task.CompletedTask;
        public Task PublishToCheckerAssignmentViewersAsync(PlatformEvent @event, CancellationToken ct = default) => Task.CompletedTask;
        public Task PublishToUsersAsync(IEnumerable<Guid> userIds, PlatformEvent @event, CancellationToken ct = default) => Task.CompletedTask;
        public Task PublishBadgeAsync(Guid userId, int pendingCount, CancellationToken ct = default) => Task.CompletedTask;
        public void RequestKpiRefresh() { }
    }
}
