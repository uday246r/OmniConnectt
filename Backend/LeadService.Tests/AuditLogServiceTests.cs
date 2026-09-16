using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using LeadManagement.Api.Data;
using LeadManagement.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LeadService.Tests;

/// <summary>
/// This service's own audit trail — who a row is attributed to, where it says the action came from,
/// and which rows a date range selects.
/// </summary>
/// <remarks>
/// <para>
/// Untested until now, and two of the defects it had were the kind that only a test catches, because
/// nothing about the output looks broken. Every row named "Admin User" with an administrator's role
/// from 127.0.0.1, and the screen rendered that as fact — a trail that is uniformly, plausibly wrong
/// is worse than one that is obviously empty, because nobody thinks to question it.
/// </para>
/// <para>
/// The date filter was worse still, in that it had never run: the endpoint accepted the parameters
/// and no UI sent them, so a bound that shifted by the server's offset and discarded the time of day
/// sat there working incorrectly for nobody. The shared date-range control is its first real caller.
/// </para>
/// </remarks>
public class AuditLogServiceTests : IDisposable
{
    private readonly ApplicationDbContext db;
    private readonly HttpContextAccessor accessor = new();
    private readonly AuditActorContext actorContext = new();
    private readonly AuditLogService service;

    public AuditLogServiceTests()
    {
        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase($"lead-audit-{Guid.NewGuid()}")
            .Options;
        db = new ApplicationDbContext(options);
        service = new AuditLogService(db, accessor, actorContext);
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    // ── Attribution ──────────────────────────────────────────────────────────

    /// <summary>
    /// The named regression. Three optional parameters defaulted to a user id, a name and a role
    /// that belong to nobody, and not one of the four call sites overrode them.
    /// </summary>
    [Fact]
    public async Task A_row_is_attributed_to_the_signed_in_caller_not_a_default()
    {
        var userId = Guid.NewGuid();
        SignIn(userId, "Priya Raman", "priya@example.com");

        await service.LogAsync("Create", "Lead", "L-1", "Created a lead");

        var row = await db.AuditLogs.SingleAsync();
        Assert.Equal(userId.ToString(), row.UserId);
        Assert.Equal("Priya Raman", row.UserName);
        Assert.NotEqual("Admin User", row.UserName);
        Assert.NotEqual("Administrator", row.UserRole);
    }

    /// <summary>
    /// The token carries a role ID, not a role name, so there is no role name to record. "Unknown" is
    /// honest about that; "Administrator", which is what the old default wrote on every row, was an
    /// assertion the system had no basis for.
    /// </summary>
    [Fact]
    public async Task A_row_says_the_role_is_unknown_rather_than_inventing_one()
    {
        SignIn(Guid.NewGuid(), "Priya Raman", "priya@example.com");

        await service.LogAsync("Create", "Lead", "L-1", "Created a lead");

        Assert.Equal("Unknown", (await db.AuditLogs.SingleAsync()).UserRole);
    }

    /// <summary>
    /// An unauthenticated write says so, rather than falling back to a plausible-looking person. A
    /// reader has to be able to tell "we do not know who did this" apart from a named actor.
    /// </summary>
    [Fact]
    public async Task A_row_written_with_no_caller_is_marked_unattributed()
    {
        await service.LogAsync("Create", "Lead", "L-1", "Created a lead");

        var row = await db.AuditLogs.SingleAsync();
        Assert.Equal("Unattributed", row.UserName);
        Assert.Equal("unattributed", row.UserId);
    }

    /// <summary>
    /// Falls back through the claims the token actually carries. A row identified only by subject id
    /// is still a real answer; inventing a display name for it would not be.
    /// </summary>
    [Fact]
    public async Task A_caller_with_no_name_claim_is_identified_by_email_then_by_subject()
    {
        var userId = Guid.NewGuid();
        SignIn(userId, name: null, email: "noname@example.com");
        await service.LogAsync("Create", "Lead", "L-1", "Created a lead");
        Assert.Equal("noname@example.com", (await db.AuditLogs.SingleAsync()).UserName);

        db.AuditLogs.RemoveRange(db.AuditLogs);
        await db.SaveChangesAsync();

        SignIn(userId, name: null, email: null);
        await service.LogAsync("Create", "Lead", "L-2", "Created a lead");
        Assert.Equal($"User {userId}", (await db.AuditLogs.SingleAsync()).UserName);
    }

    /// <summary>
    /// The approval-replay path. The request arrives from AuthService with the internal API key and
    /// no user token, so the caller lookup finds nobody — but the change has a perfectly well-known
    /// author, the maker who submitted it. Without the override the local row would read
    /// "Unattributed" for a change the central trail attributes correctly, and the two records of the
    /// same event would disagree.
    /// </summary>
    [Fact]
    public async Task A_replayed_mutation_is_attributed_to_the_maker_not_to_nobody()
    {
        var makerId = Guid.NewGuid();
        actorContext.AttributeTo(makerId, "Original Maker");

        await service.LogAsync("Create", "Lead", "L-1", "Created a lead through an approved request");

        var row = await db.AuditLogs.SingleAsync();
        Assert.Equal(makerId.ToString(), row.UserId);
        Assert.Equal("Original Maker", row.UserName);
    }

    /// <summary>
    /// An explicit argument still wins over the ambient override, so a caller that genuinely knows
    /// better is not overruled by a request-scoped default it may not know about.
    /// </summary>
    [Fact]
    public async Task An_explicit_actor_takes_precedence_over_the_request_override()
    {
        actorContext.AttributeTo(Guid.NewGuid(), "Ambient Maker");

        await service.LogAsync(
            "Create", "Lead", "L-1", "Created a lead",
            actor: new AuditActor("explicit-id", "Explicit Actor"));

        Assert.Equal("Explicit Actor", (await db.AuditLogs.SingleAsync()).UserName);
    }

    /// <summary>
    /// The source address was the literal string "127.0.0.1" on every row, which reads as a finding
    /// rather than as missing data.
    /// </summary>
    [Fact]
    public async Task A_row_records_the_callers_real_address()
    {
        SignIn(Guid.NewGuid(), "Priya Raman", "priya@example.com");
        accessor.HttpContext!.Connection.RemoteIpAddress = System.Net.IPAddress.Parse("203.0.113.7");

        await service.LogAsync("Create", "Lead", "L-1", "Created a lead");

        Assert.Equal("203.0.113.7", (await db.AuditLogs.SingleAsync()).IpAddress);
    }

    // ── Date filtering ───────────────────────────────────────────────────────

    /// <summary>
    /// The bound keeps the time of day it was given.
    /// </summary>
    /// <remarks>
    /// The old implementation parsed a string, called <c>.Date</c> — discarding the time entirely —
    /// and then ran <c>.ToUniversalTime()</c> on a Kind-Unspecified value, shifting it by the
    /// server's offset a second time. At UTC+8 a 09:00 lower bound became 16:00 the previous day, so
    /// a range typed by an operator selected a window they never asked for.
    /// </remarks>
    [Fact]
    public async Task A_date_range_bound_keeps_its_time_of_day()
    {
        var day = new DateTimeOffset(2026, 3, 12, 0, 0, 0, TimeSpan.Zero);
        await SeedRowAtAsync(day.AddHours(8), "before-the-window");
        await SeedRowAtAsync(day.AddHours(10), "inside-the-window");
        await SeedRowAtAsync(day.AddHours(18), "after-the-window");

        var result = await service.GetAuditLogsAsync(
            from: day.AddHours(9), to: day.AddHours(17));

        var descriptions = result.Items.Select(i => i.Description).ToList();
        Assert.Equal(["inside-the-window"], descriptions);
    }

    /// <summary>
    /// Inclusive on both ends, matching AuthService's audit and system-log queries — so one range
    /// typed into the shared date control selects the same rows on every log screen in the platform.
    /// </summary>
    [Fact]
    public async Task A_date_range_includes_rows_exactly_on_both_bounds()
    {
        var from = new DateTimeOffset(2026, 3, 12, 9, 0, 0, TimeSpan.Zero);
        var to = new DateTimeOffset(2026, 3, 12, 17, 0, 0, TimeSpan.Zero);
        await SeedRowAtAsync(from, "on-the-lower-bound");
        await SeedRowAtAsync(to, "on-the-upper-bound");

        var result = await service.GetAuditLogsAsync(from: from, to: to);

        Assert.Equal(2, result.TotalRecords);
    }

    /// <summary>
    /// A bound expressed in a non-UTC offset means the instant it denotes, not the wall-clock reading
    /// it resembles. This is the case the double-conversion in the old code got wrong.
    /// </summary>
    [Fact]
    public async Task A_bound_in_another_offset_is_compared_as_an_instant()
    {
        // 17:30 at UTC+8 is 09:30 UTC.
        var utcRow = new DateTimeOffset(2026, 3, 12, 9, 30, 0, TimeSpan.Zero);
        await SeedRowAtAsync(utcRow, "the-row");

        var boundInSingapore = new DateTimeOffset(2026, 3, 12, 17, 0, 0, TimeSpan.FromHours(8));

        var included = await service.GetAuditLogsAsync(from: boundInSingapore);
        Assert.Equal(1, included.TotalRecords);

        var excluded = await service.GetAuditLogsAsync(from: boundInSingapore.AddHours(1));
        Assert.Equal(0, excluded.TotalRecords);
    }

    // ── Export ───────────────────────────────────────────────────────────────

    /// <summary>
    /// The export covers the whole filtered set, not the page that happens to be on screen. The
    /// browser-built version it replaces serialised whichever ten rows were loaded and named the file
    /// as though it were the audit log.
    /// </summary>
    [Fact]
    public async Task An_export_covers_every_matching_row_not_just_the_current_page()
    {
        for (var i = 0; i < 25; i++)
        {
            await SeedRowAtAsync(DateTimeOffset.UtcNow.AddMinutes(-i), $"row-{i}");
        }

        var page = await service.GetAuditLogsAsync(page: 1, pageSize: 10);
        var export = await service.ExportAuditLogsCsvAsync();

        Assert.Equal(10, page.Items.Count);
        Assert.Equal(25, export.RowCount);
        Assert.Equal(25, export.MatchCount);
        Assert.False(export.Truncated);
    }

    [Fact]
    public async Task An_export_applies_the_same_filters_the_list_applies()
    {
        await SeedRowAtAsync(DateTimeOffset.UtcNow, "kept", actionType: "Create");
        await SeedRowAtAsync(DateTimeOffset.UtcNow, "dropped", actionType: "Delete");

        var export = await service.ExportAuditLogsCsvAsync(actionType: "Create");

        Assert.Contains("kept", export.Content);
        Assert.DoesNotContain("dropped", export.Content);
    }

    /// <summary>
    /// Actor and outcome were filtered in the browser over one fetched page, so a match on any other
    /// page was unreachable and the export ignored both. They are query parameters now.
    /// </summary>
    [Fact]
    public async Task Actor_is_matched_by_name_or_role_ignoring_case_across_every_page()
    {
        for (var i = 0; i < 30; i++) await SeedRowAtAsync(DateTimeOffset.UtcNow.AddMinutes(-i), $"noise-{i}");
        await SeedRowAtAsync(DateTimeOffset.UtcNow.AddDays(-3), "by-name", userName: "Aiman Hakim");
        await SeedRowAtAsync(DateTimeOffset.UtcNow.AddDays(-4), "by-role", userName: "Someone", userRole: "Branch Auditor");

        var byName = await service.GetAuditLogsAsync(page: 1, pageSize: 10, actor: "aiman");
        var byRole = await service.GetAuditLogsAsync(page: 1, pageSize: 10, actor: "AUDITOR");

        Assert.Equal(["by-name"], byName.Items.Select(i => i.Description));
        Assert.Equal(1, byName.TotalRecords);
        Assert.Equal(["by-role"], byRole.Items.Select(i => i.Description));
    }

    [Fact]
    public async Task Status_splits_failures_from_everything_else()
    {
        await SeedRowAtAsync(DateTimeOffset.UtcNow, "ok", status: "Success");
        await SeedRowAtAsync(DateTimeOffset.UtcNow, "failed-upper", status: "FAILED");
        await SeedRowAtAsync(DateTimeOffset.UtcNow, "failed-word", status: "Failure");

        var failed = await service.GetAuditLogsAsync(status: "FAILED");
        var succeeded = await service.GetAuditLogsAsync(status: "SUCCESS");

        Assert.Equal(["failed-upper", "failed-word"], failed.Items.Select(i => i.Description).Order());
        Assert.Equal(["ok"], succeeded.Items.Select(i => i.Description));
    }

    [Fact]
    public async Task The_export_honours_actor_and_status_exactly_as_the_list_does()
    {
        await SeedRowAtAsync(DateTimeOffset.UtcNow, "wanted", userName: "Aiman Hakim", status: "FAILED");
        await SeedRowAtAsync(DateTimeOffset.UtcNow, "wrong-status", userName: "Aiman Hakim", status: "Success");
        await SeedRowAtAsync(DateTimeOffset.UtcNow, "wrong-actor", userName: "Priya Raman", status: "FAILED");

        var list = await service.GetAuditLogsAsync(actor: "aiman", status: "FAILED");
        var export = await service.ExportAuditLogsCsvAsync(actor: "aiman", status: "FAILED");

        Assert.Equal(list.TotalRecords, export.MatchCount);
        Assert.Contains("wanted", export.Content);
        Assert.DoesNotContain("wrong-status", export.Content);
        Assert.DoesNotContain("wrong-actor", export.Content);
    }

    /// <summary>
    /// The before/after snapshots stay out of the file. They are whole lead records — customer names,
    /// IC numbers, amounts — and an export leaves the platform, while the drawer that shows them does
    /// not.
    /// </summary>
    [Fact]
    public async Task An_export_omits_the_before_and_after_snapshots()
    {
        db.AuditLogs.Add(new LeadManagement.Api.Models.Entities.AuditLog
        {
            Timestamp = DateTime.UtcNow,
            UserId = "u1",
            UserName = "Priya Raman",
            UserRole = "Unknown",
            ActionType = "Edit",
            EntityType = "Lead",
            EntityId = "L-1",
            Description = "Updated a lead",
            PreviousValues = """{"icNumber":"900101-14-5678"}""",
            NewValues = """{"icNumber":"900101-14-5679"}""",
            IpAddress = "203.0.113.7",
            Status = "Success",
        });
        await db.SaveChangesAsync();

        var export = await service.ExportAuditLogsCsvAsync();

        Assert.Contains("Updated a lead", export.Content);
        Assert.DoesNotContain("900101-14-5678", export.Content);
    }

    // ── Fixtures ─────────────────────────────────────────────────────────────

    private void SignIn(Guid userId, string? name, string? email)
    {
        var claims = new List<Claim> { new(JwtRegisteredClaimNames.Sub, userId.ToString()) };
        if (name is not null) claims.Add(new Claim(JwtRegisteredClaimNames.Name, name));
        if (email is not null) claims.Add(new Claim(JwtRegisteredClaimNames.Email, email));

        accessor.HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth")),
        };
    }

    private async Task SeedRowAtAsync(
        DateTimeOffset at, string description, string actionType = "Create",
        string userName = "Priya Raman", string userRole = "Unknown", string status = "Success")
    {
        db.AuditLogs.Add(new LeadManagement.Api.Models.Entities.AuditLog
        {
            Timestamp = at.UtcDateTime,
            UserId = "u1",
            UserName = userName,
            UserRole = userRole,
            ActionType = actionType,
            EntityType = "Lead",
            EntityId = $"L-{Guid.NewGuid():N}",
            Description = description,
            IpAddress = "203.0.113.7",
            Status = status,
        });
        await db.SaveChangesAsync();
    }
}
