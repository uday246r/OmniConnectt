using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// The audit trail's write and query surface.
/// </summary>
/// <remarks>
/// Worth testing closely because the audit log is the one part of this platform whose entire value is
/// that it is accurate and complete. A row with the wrong actor, or a query that silently drops a
/// filter, does not degrade a feature — it produces a record that looks authoritative and is wrong,
/// which is worse than having no record at all. Two of the tests here pin defects that had exactly
/// that shape.
/// </remarks>
public class AuditLogEnhancementTests : IDisposable
{
    private readonly AuthDbContext db;
    private readonly AuditLogAppService service;
    private readonly RecordingPublisher events;

    public AuditLogEnhancementTests()
    {
        db = TestDb.Create("auditlogs");
        events = new RecordingPublisher();
        service = TestAudit.For(db, events);
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public async Task Exporting_applies_the_same_filters_the_list_applies()
    {
        var userA = Guid.NewGuid();
        var userB = Guid.NewGuid();

        await service.WriteAsync("AuthService", userA, "User Alpha", "lead.created", "Lead", "101", null, sourceIp: "127.0.0.1", correlationId: "corr-1");
        await service.WriteAsync("AuthService", userB, "User Beta", "lead.created", "Lead", "102", null, sourceIp: "127.0.0.1", correlationId: "corr-2");

        var export = await service.ExportCsvAsync(new AuditLogFilter { ActorName = "User Alpha", CorrelationId = "corr-1" });

        Assert.Contains("User Alpha", export.Content);
        Assert.DoesNotContain("User Beta", export.Content);
        Assert.Contains("lead.created", export.Content);
    }

    /// <summary>
    /// The named regression. The User detail page's "export this user's activity" sent an
    /// <c>actorUserId</c>; <c>ExportCsvAsync</c> had no parameter for it while <c>ListAsync</c> did,
    /// so the value was dropped and the operator received the entire platform's audit trail under a
    /// success message. Both now take one <see cref="AuditLogFilter"/>, which makes the two filter
    /// sets impossible to drift apart again.
    /// </summary>
    [Fact]
    public async Task Exporting_scoped_to_one_actor_contains_only_that_actors_rows()
    {
        var subject = Guid.NewGuid();
        var somebodyElse = Guid.NewGuid();

        await service.WriteAsync("AuthService", subject, "Subject User", "user.updated", "User", "1", "Subject did a thing");
        await service.WriteAsync("AuthService", somebodyElse, "Unrelated User", "user.updated", "User", "2", "Someone else did a thing");

        var filter = new AuditLogFilter { ActorUserId = subject };

        var listed = await service.ListAsync(1, 50, filter);
        var exported = await service.ExportCsvAsync(filter);

        Assert.Equal(1, listed.Total);
        Assert.Contains("Subject User", exported.Content);
        Assert.DoesNotContain("Unrelated User", exported.Content);
        Assert.Equal(listed.Total, exported.RowCount);
    }

    /// <summary>
    /// Every filter on the record has to reach the query, and reach BOTH consumers of it. Reflection
    /// rather than one assertion per property, so a filter added later is covered the day it is
    /// added rather than the day someone remembers to write a test for it.
    /// </summary>
    [Fact]
    public async Task Every_filter_on_the_record_narrows_both_the_list_and_the_export()
    {
        var actor = Guid.NewGuid();
        await service.WriteAsync(
            "LeadService", actor, "Findable Actor", "lead.created", "Lead", "L-1", "A findable row",
            sourceIp: "10.0.0.9", authMethod: "Local", correlationId: "corr-findable",
            entityLabel: "Acme Corp", sourceApplication: "Lead Management", module: "Leads",
            page: "create-lead", actionCategory: "CRUD",
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Firefox/121.0");

        // One value per filter that MATCHES the row above, so every clause must return it. A clause
        // wired to the wrong column, or not wired at all, shows up as the wrong count.
        var matching = new Dictionary<string, AuditLogFilter>
        {
            ["Service"] = new() { Service = "LeadService" },
            ["Action"] = new() { Action = "lead.created" },
            ["Result"] = new() { Result = "Success" },
            ["ActorUserId"] = new() { ActorUserId = actor },
            ["InvolvingUserId"] = new() { InvolvingUserId = actor },
            ["ExcludeActorUserId"] = new() { ExcludeActorUserId = Guid.NewGuid() },
            ["ActorName"] = new() { ActorName = "Findable" },
            ["CorrelationId"] = new() { CorrelationId = "corr-findable" },
            ["EntityType"] = new() { EntityType = "Lead" },
            ["EntityId"] = new() { EntityId = "Acme" },
            ["SourceApplication"] = new() { SourceApplication = "Lead Management" },
            ["Module"] = new() { Module = "Leads" },
            ["PageName"] = new() { PageName = "create-lead" },
            ["ActionCategory"] = new() { ActionCategory = "CRUD" },
            ["AuthMethod"] = new() { AuthMethod = "Local" },
            ["SourceIp"] = new() { SourceIp = "10.0.0.9" },
            ["Device"] = new() { Device = "macOS" },
            ["From"] = new() { From = DateTimeOffset.UtcNow.AddMinutes(-5) },
            ["To"] = new() { To = DateTimeOffset.UtcNow.AddMinutes(5) },
        };

        var covered = typeof(AuditLogFilter).GetProperties().Select(p => p.Name).ToHashSet();
        Assert.True(
            covered.SetEquals(matching.Keys),
            $"AuditLogFilter has properties this test does not exercise: {string.Join(", ", covered.Except(matching.Keys))}");

        foreach (var (name, filter) in matching)
        {
            var listed = await service.ListAsync(1, 50, filter);
            var exported = await service.ExportCsvAsync(filter);

            Assert.True(listed.Total == 1, $"Filtering the list by {name} did not match the row.");
            Assert.True(exported.RowCount == 1, $"Filtering the export by {name} did not match the row.");
        }
    }

    [Fact]
    public async Task An_export_reports_how_many_rows_matched_even_when_it_returns_all_of_them()
    {
        await service.WriteAsync("AuthService", Guid.NewGuid(), "Tester", "user.created", "User", "1", null);
        await service.WriteAsync("AuthService", Guid.NewGuid(), "Tester", "user.created", "User", "2", null);

        var export = await service.ExportCsvAsync(new AuditLogFilter());

        Assert.Equal(2, export.RowCount);
        Assert.Equal(2, export.MatchCount);
        Assert.False(export.Truncated);
    }

    /// <summary>
    /// The correlation id is an internal request identifier. It is genuinely useful inside the
    /// product — it is how "show me the rest of this operation" works — and meaningless outside it,
    /// so it stays out of a file that leaves the platform rather than inviting someone downstream to
    /// treat it as a business key.
    /// </summary>
    [Fact]
    public async Task An_export_never_carries_the_internal_correlation_id()
    {
        await service.WriteAsync("AuthService", Guid.NewGuid(), "Tester", "user.created", "User", "1", null, correlationId: "internal-secret-correlation-guid");

        var export = await service.ExportCsvAsync(new AuditLogFilter());

        var header = export.Content.Split('\n')[0];
        Assert.DoesNotContain("CorrelationId", header);
        Assert.DoesNotContain("internal-secret-correlation-guid", export.Content);
    }

    /// <summary>
    /// An audit export is opened in a spreadsheet by definition, and it carries operator-supplied
    /// text — a rejection reason, a customer name, someone's own display name. A value starting with
    /// <c>=</c> is evaluated on open unless it is defused.
    /// </summary>
    [Fact]
    public async Task A_field_that_would_be_read_as_a_spreadsheet_formula_is_defused()
    {
        await service.WriteAsync(
            "AuthService", Guid.NewGuid(), "=cmd|'/c calc'!A1", "user.created", "User", "1",
            "A value with, a comma and a \"quote\"");

        var export = await service.ExportCsvAsync(new AuditLogFilter());

        // Quoted and tab-prefixed: still legible to a human reading the file, inert to the parser.
        Assert.Contains("\"\t=cmd", export.Content);
        // Ordinary special characters keep the plain RFC 4180 treatment.
        Assert.Contains("\"A value with, a comma and a \"\"quote\"\"\"", export.Content);
    }

    /// <summary>
    /// HostOrRemote and RemoteName are DERIVED from SourceApplication rather than passed in, so a
    /// caller cannot claim to be the host while naming a remote, or vice versa. This pins that
    /// derivation and the query path depending on it — the Audit Logs page's Application filter
    /// matches on SourceApplication, so a writer that omits it makes its row unfindable by app.
    /// </summary>
    [Fact]
    public async Task A_row_from_a_remote_derives_its_host_or_remote_origin_from_the_application_name()
    {
        var userId = Guid.NewGuid();
        await service.WriteAsync(
            serviceName: "LeadService",
            actorUserId: userId,
            actorName: "John Doe",
            action: "lead.created",
            entityType: "Lead",
            entityId: "101",
            details: "Created lead 'Acme Corp'.",
            sourceIp: "127.0.0.1",
            sourceApplication: "Lead Management",
            module: "Leads",
            page: "create-lead",
            actionCategory: "CRUD");

        var stored = await db.AuditLogs.FirstOrDefaultAsync();

        Assert.NotNull(stored);
        Assert.Equal("Lead Management", stored.SourceApplication);
        Assert.Equal("Remote", stored.HostOrRemote);
        Assert.Equal("Lead Management", stored.RemoteName);

        var result = await service.ListAsync(1, 10, new AuditLogFilter { SourceApplication = "Lead Management" });

        Assert.Equal(1, result.Total);
        Assert.Equal("CRUD", result.Items[0].ActionCategory);
    }

    /// <summary>
    /// The host's own mutations must be findable by application too. Every in-process writer used to
    /// omit SourceApplication, so HostOrRemote and RemoteName were null on every host row and
    /// selecting "Host" in the Application filter returned nothing while the rows sat in plain view.
    /// </summary>
    [Fact]
    public async Task A_row_from_the_host_is_marked_as_host_and_names_no_remote()
    {
        await service.WriteHostAsync(
            Guid.NewGuid(), "Jane Doe", "user.created",
            AuditLogAppService.Modules.Users, AuditLogAppService.Categories.Crud,
            entityType: "User", entityId: Guid.NewGuid().ToString());

        var stored = await db.AuditLogs.FirstAsync();

        Assert.Equal("Host", stored.SourceApplication);
        Assert.Equal("Host", stored.HostOrRemote);
        Assert.Null(stored.RemoteName);
        Assert.Equal("AuthService", stored.ServiceName);
        Assert.Equal(AuditLogAppService.Modules.Users, stored.Module);
    }

    /// <summary>
    /// The summary cards sit directly above the table. They used to count the whole date range while
    /// the table below them showed one filtered slice — two numbers describing different populations,
    /// adjacent, with nothing saying so.
    /// </summary>
    [Fact]
    public async Task The_summary_counts_the_same_rows_the_filtered_list_shows()
    {
        await service.WriteHostAsync(Guid.NewGuid(), "A", "auth.login_succeeded", AuditLogAppService.Modules.Authentication, AuditLogAppService.Categories.Auth);
        await service.WriteHostAsync(Guid.NewGuid(), "B", "auth.login_failed", AuditLogAppService.Modules.Authentication, AuditLogAppService.Categories.Auth, result: "Failure");
        await service.WriteAsync("LeadService", Guid.NewGuid(), "C", "lead.created", null, null, null, sourceApplication: "Lead Management");

        var hostOnly = new AuditLogFilter { SourceApplication = "Host" };
        var summary = await service.SummaryAsync(hostOnly);
        var listed = await service.ListAsync(1, 50, hostOnly);

        Assert.Equal(listed.Total, summary.TotalAuditEvents);
        Assert.Equal(1, summary.LoginSuccesses);
        Assert.Equal(1, summary.LoginErrors);
    }

    /// <summary>
    /// Facets exist so the page's dropdowns can offer real options once filtering became server-side.
    /// The important property is that they narrow with the OTHER filters — the old client-derived
    /// lists did not, so the Action dropdown offered actions the chosen Service had already excluded.
    /// </summary>
    [Fact]
    public async Task Facets_offer_only_values_that_survive_the_other_active_filters()
    {
        await service.WriteAsync("LeadService", Guid.NewGuid(), "A", "lead.created", null, null, null, sourceApplication: "Lead Management", module: "Leads");
        await service.WriteAsync("AuthService", Guid.NewGuid(), "B", "user.created", null, null, null, sourceApplication: "Host", module: "Users");

        var facets = await service.FacetsAsync(new AuditLogFilter { SourceApplication = "Host" });

        Assert.Equal(["Users"], facets.Modules);
        Assert.Equal(["user.created"], facets.Actions.Select(a => a.Action));
        Assert.DoesNotContain("Leads", facets.Modules);
    }

    /// <summary>
    /// The four simple facet lists now come from one UNION query tagged by column rather than four
    /// queries. The risk that introduces is a value leaking into the wrong list — a module name showing
    /// up among pages because the same text appears in both columns.
    /// </summary>
    [Fact]
    public async Task Each_facet_list_holds_only_its_own_columns_values_sorted_and_distinct()
    {
        await service.WriteAsync("AuthService", Guid.NewGuid(), "A", "auth.login_succeeded", null, null, null,
            authMethod: "Local", module: "Authentication", page: "login", actionCategory: "Auth");
        await service.WriteAsync("AuthService", Guid.NewGuid(), "B", "auth.login_succeeded", null, null, null,
            authMethod: "Google", module: "Authentication", page: "login", actionCategory: "Auth");
        await service.WriteAsync("AuthService", Guid.NewGuid(), "C", "page.viewed", null, null, null,
            module: "Users", page: "Users", actionCategory: "Navigation");

        var facets = await service.FacetsAsync(new AuditLogFilter());

        Assert.Equal(["Google", "Local"], facets.AuthMethods);
        Assert.Equal(["Authentication", "Users"], facets.Modules);
        Assert.Equal(["Users", "login"], facets.Pages);
        Assert.Equal(["Auth", "Navigation"], facets.ActionCategories);
    }

    /// <summary>
    /// Every audit write notifies anyone watching the Audit Logs page. Pinned because the write path
    /// swallows publish failures by design, so a broken fan-out is silent at runtime.
    /// </summary>
    [Fact]
    public async Task Writing_a_row_notifies_the_audit_viewers()
    {
        await service.WriteHostAsync(
            Guid.NewGuid(), "Jane", "user.created",
            AuditLogAppService.Modules.Users, AuditLogAppService.Categories.Crud);

        var published = Assert.Single(events.AuditViewerEvents);
        Assert.Equal("audit-logs", published.Topic);
        Assert.Equal("user.created", published.Action);
        Assert.Equal(1, events.KpiRefreshRequests);
    }
}
