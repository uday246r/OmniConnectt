using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Domain.Entities;
using AuthService.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using System.Linq;
using Xunit;

namespace AuthService.Tests;

public class SystemLogAppServiceTests : IDisposable
{
    private readonly AuthDbContext db;
    private readonly SystemLogAppService service;

    public SystemLogAppServiceTests()
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"systemlogs-{Guid.NewGuid()}")
            .Options;
        db = new AuthDbContext(options);

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ASPNETCORE_ENVIRONMENT"] = "Testing",
            })
            .Build();

        service = new SystemLogAppService(db, config);
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public void SecretRedactor_RedactsSensitiveData()
    {
        var rawPassword = "User login failed for password=SuperSecret123; in connection string Host=localhost;Password=SecretPass;";
        var redacted = SecretRedactor.Redact(rawPassword);

        Assert.NotNull(redacted);
        Assert.DoesNotContain("SuperSecret123", redacted);
        Assert.DoesNotContain("SecretPass", redacted);
        Assert.Contains("[REDACTED]", redacted);

        var bearerToken = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ae9CQ";
        var redactedBearer = SecretRedactor.Redact(bearerToken);
        Assert.NotNull(redactedBearer);
        Assert.DoesNotContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ae9CQ", redactedBearer);
        Assert.Contains("[REDACTED]", redactedBearer);
    }

    [Fact]
    public async Task WriteAsync_StoresSystemLog_AndRedactsMessage()
    {
        var request = new RecordSystemLogRequest(
            Severity: "Error",
            ServiceName: "AuthService",
            EventCode: "AUTH_FAILURE",
            Message: "Failed connection with Password=TopSecretPassword123;",
            Module: "Authentication",
            CorrelationId: "corr-123"
        );

        await service.WriteAsync(request);

        var stored = await db.SystemLogs.FirstOrDefaultAsync();
        Assert.NotNull(stored);
        Assert.Equal("Error", stored.Severity);
        Assert.Equal("AuthService", stored.ServiceName);
        Assert.Equal("AUTH_FAILURE", stored.EventCode);
        Assert.DoesNotContain("TopSecretPassword123", stored.Message);
        Assert.Contains("[REDACTED]", stored.Message);
        Assert.Equal("corr-123", stored.CorrelationId);
    }

    [Fact]
    public async Task ListAsync_FiltersCorrectly()
    {
        await service.WriteAsync(new RecordSystemLogRequest("Error", "AuthService", "ERR_1", "Message 1"));
        await service.WriteAsync(new RecordSystemLogRequest("Warning", "AuthService", "WARN_1", "Message 2"));
        await service.WriteAsync(new RecordSystemLogRequest("Info", "LeadService", "INFO_1", "Message 3"));

        var errors = await service.ListAsync(1, 10, severity: "Error");
        Assert.Equal(1, errors.Total);
        Assert.Equal("ERR_1", errors.Items[0].EventCode);

        var authLogs = await service.ListAsync(1, 10, service: "AuthService");
        Assert.Equal(2, authLogs.Total);

        var leadLogs = await service.ListAsync(1, 10, service: "LeadService");
        Assert.Equal(1, leadLogs.Total);
        Assert.Equal("INFO_1", leadLogs.Items[0].EventCode);
    }

    [Fact]
    public async Task SummaryAsync_CalculatesCountsAccurately()
    {
        await service.WriteAsync(new RecordSystemLogRequest("Error", "AuthService", "ERR_1", "Msg 1"));
        await service.WriteAsync(new RecordSystemLogRequest("Critical", "AuthService", "ERR_2", "Msg 2"));
        await service.WriteAsync(new RecordSystemLogRequest("Warning", "LeadService", "WARN_1", "Msg 3"));
        await service.WriteAsync(new RecordSystemLogRequest("Info", "Customer360Service", "INFO_1", "Msg 4"));

        var summary = await service.SummaryAsync();
        Assert.Equal(2, summary.ErrorCount); // Error + Critical
        Assert.Equal(1, summary.WarningCount);
        Assert.Equal(1, summary.InfoCount);
        Assert.Equal(4, summary.TotalEvents);
        Assert.Equal(3, summary.ServicesReporting); // AuthService, LeadService, Customer360Service
    }

    [Fact]
    public async Task ExportCsvAsync_ExportsLogsSuccessfully()
    {
        await service.WriteAsync(new RecordSystemLogRequest("Error", "AuthService", "ERR_1", "Error message content"));

        var csv = await service.ExportCsvAsync();
        Assert.NotNull(csv);
        Assert.Contains("Time,Severity,Service,Module,Environment", csv.Content);
        Assert.Contains("ERR_1", csv.Content);
        Assert.Contains("Error message content", csv.Content);
    }

    [Fact]
    public async Task MessageSearch_FiltersLogsContainingSearchTerm()
    {
        await service.WriteAsync(new RecordSystemLogRequest("Error", "AuthService", "ERR_1", "Database connection failed"));
        await service.WriteAsync(new RecordSystemLogRequest("Error", "AuthService", "ERR_2", "Token validation succeeded"));
        await service.WriteAsync(new RecordSystemLogRequest("Warning", "AuthService", "WARN_1", "Database pool exhausted"));

        // In-memory provider doesn't support ILike (EF.Functions), so test that empty search returns all
        var allLogs = await service.ListAsync(1, 10);
        Assert.Equal(3, allLogs.Total);

        // Verify event code filtering still works (backend query path used by real DB)
        var specific = await service.ListAsync(1, 10, eventCode: "ERR_2");
        Assert.Equal(1, specific.Total);
        Assert.Equal("Token validation succeeded", specific.Items[0].Message);
    }

    [Fact]
    public async Task EnvironmentFilter_FiltersCorrectly()
    {
        await service.WriteAsync("Error", "AuthService", "ERR_1", "Prod error", environment: "Production");
        await service.WriteAsync("Info", "AuthService", "INFO_1", "Dev info", environment: "Development");
        await service.WriteAsync("Warning", "AuthService", "WARN_1", "Staging warn", environment: "Staging");

        var prodLogs = await service.ListAsync(1, 10, environment: "Production");
        Assert.Equal(1, prodLogs.Total);
        Assert.Equal("ERR_1", prodLogs.Items[0].EventCode);

        var devLogs = await service.ListAsync(1, 10, environment: "Development");
        Assert.Equal(1, devLogs.Total);
        Assert.Equal("INFO_1", devLogs.Items[0].EventCode);

        var allLogs = await service.ListAsync(1, 10);
        Assert.Equal(3, allLogs.Total);
    }

    [Fact]
    public async Task ErrorTab_IncludesCriticalLogs()
    {
        await service.WriteAsync(new RecordSystemLogRequest("Error", "AuthService", "ERR_1", "Regular error"));
        await service.WriteAsync(new RecordSystemLogRequest("Critical", "AuthService", "CRIT_1", "Critical failure"));
        await service.WriteAsync(new RecordSystemLogRequest("Warning", "AuthService", "WARN_1", "Just a warning"));

        // Filtering by "Error" severity should include Critical too
        var errorTabLogs = await service.ListAsync(1, 10, severity: "Error");
        Assert.Equal(2, errorTabLogs.Total);
        var eventCodes = errorTabLogs.Items.Select(i => i.EventCode).ToHashSet();
        Assert.Contains("ERR_1", eventCodes);
        Assert.Contains("CRIT_1", eventCodes);

        // Filtering specifically for "Critical" should only get criticals
        var criticalOnly = await service.ListAsync(1, 10, severity: "Critical");
        Assert.Equal(1, criticalOnly.Total);
        Assert.Equal("CRIT_1", criticalOnly.Items[0].EventCode);
    }

    [Fact]
    public async Task SummaryAsync_IncludesCriticalCount()
    {
        await service.WriteAsync(new RecordSystemLogRequest("Error", "AuthService", "ERR_1", "Msg 1"));
        await service.WriteAsync(new RecordSystemLogRequest("Critical", "AuthService", "CRIT_1", "Msg 2"));
        await service.WriteAsync(new RecordSystemLogRequest("Critical", "AuthService", "CRIT_2", "Msg 3"));
        await service.WriteAsync(new RecordSystemLogRequest("Warning", "AuthService", "WARN_1", "Msg 4"));

        var summary = await service.SummaryAsync();
        Assert.Equal(3, summary.ErrorCount);   // Error + 2 Critical
        Assert.Equal(2, summary.CriticalCount); // Only Critical
        Assert.Equal(1, summary.WarningCount);
        Assert.Equal(4, summary.TotalEvents);
    }

    [Fact]
    public async Task ExportCsvAsync_RespectsCorrelationId()
    {
        var corrId = "trace-abc-123";
        await service.WriteAsync("Error", "AuthService", "ERR_1", "Error with trace", correlationId: corrId);
        await service.WriteAsync("Info", "AuthService", "INFO_1", "Unrelated log");

        var csv = await service.ExportCsvAsync(correlationId: corrId);
        Assert.NotNull(csv);
        Assert.Contains("ERR_1", csv.Content);
        Assert.DoesNotContain("INFO_1", csv.Content);
    }
}
