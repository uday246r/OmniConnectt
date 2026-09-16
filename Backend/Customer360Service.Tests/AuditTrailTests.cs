using backend.Data;
using backend.Infrastructure;
using backend.Models;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Customer360Service.Tests;

/// <summary>
/// This service's audit trail after its timestamp stopped being text.
/// </summary>
/// <remarks>
/// <para>
/// <c>AuditLog.Timestamp</c> held <c>DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss")</c> — the
/// application server's local wall clock with the offset discarded — in a text column that rows were
/// ordered by sorting. It looked correct, because that format happens to sort lexicographically in
/// chronological order, but only for rows written at one fixed offset. Two consequences followed: a
/// range query could not be expressed at all, which is why this was the only log surface on the
/// platform with no date filter, and a deployment spanning a DST change or two timezones would
/// interleave rows out of order while still appearing perfectly sorted.
/// </para>
/// <para>
/// These tests pin the behaviour the column now has, and one of them covers a case the old text
/// ordering got silently wrong.
/// </para>
/// </remarks>
public class AuditTrailTests : IDisposable
{
    private readonly Customer360DbContext db;
    private readonly AuditRepository repository;

    public AuditTrailTests()
    {
        var options = new DbContextOptionsBuilder<Customer360DbContext>()
            .UseInMemoryDatabase($"c360-audit-{Guid.NewGuid()}")
            .Options;
        db = new Customer360DbContext(options);
        repository = new AuditRepository(db);
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <summary>
    /// The case text ordering got wrong. At the end of daylight saving the local clock repeats an
    /// hour, so 01:30 occurs twice — and as text the SECOND occurrence sorts identically to the
    /// first, or before it once the offset shifts. As instants they order correctly, because the
    /// offset is part of the value rather than discarded.
    /// </summary>
    [Fact]
    public async Task Rows_stay_in_chronological_order_across_a_daylight_saving_boundary()
    {
        // Two instants an hour apart. Rendered in local wall-clock text, both read "01:30".
        var earlier = new DateTimeOffset(2026, 10, 25, 1, 30, 0, TimeSpan.FromHours(2));
        var later = new DateTimeOffset(2026, 10, 25, 1, 30, 0, TimeSpan.FromHours(1));
        Assert.True(later > earlier, "The fixture is wrong: the second instant must be the later one.");

        await AddAsync(earlier, "the earlier one");
        await AddAsync(later, "the later one");

        var (items, _) = await repository.GetAsync(new AuditQuery(), pageNumber: 1, pageSize: 10);

        Assert.Equal(["the later one", "the earlier one"], items.Select(i => i.Description));
    }

    [Fact]
    public async Task A_date_range_selects_rows_by_instant()
    {
        var day = new DateTimeOffset(2026, 3, 12, 0, 0, 0, TimeSpan.Zero);
        await AddAsync(day.AddHours(8), "before");
        await AddAsync(day.AddHours(10), "inside");
        await AddAsync(day.AddHours(18), "after");

        var (items, total) = await repository.GetAsync(
            new AuditQuery { From = day.AddHours(9), To = day.AddHours(17) }, pageNumber: 1, pageSize: 10);

        Assert.Equal(1, total);
        Assert.Equal("inside", items[0].Description);
    }

    /// <summary>
    /// Inclusive on both ends, matching AuthService and LeadService — so one range typed into the
    /// shared date control means the same thing on every log screen.
    /// </summary>
    [Fact]
    public async Task A_date_range_includes_rows_exactly_on_both_bounds()
    {
        var from = new DateTimeOffset(2026, 3, 12, 9, 0, 0, TimeSpan.Zero);
        var to = new DateTimeOffset(2026, 3, 12, 17, 0, 0, TimeSpan.Zero);
        await AddAsync(from, "lower");
        await AddAsync(to, "upper");

        var (_, total) = await repository.GetAsync(new AuditQuery { From = from, To = to }, pageNumber: 1, pageSize: 10);

        Assert.Equal(2, total);
    }

    /// <summary>
    /// The remote's Audit Logs screen filters "VIEW" as a prefix, so both <c>VIEW_PROFILE</c> and
    /// <c>VIEW_SENSITIVE_DATA</c> land under it. Preserved deliberately when the write path moved
    /// server-side: the existing history is written in this vocabulary, and changing it would orphan
    /// every row already in the table.
    /// </summary>
    [Fact]
    public async Task The_view_filter_matches_every_action_beginning_with_view()
    {
        await AddAsync(DateTimeOffset.UtcNow, "a profile view", action: "VIEW_PROFILE");
        await AddAsync(DateTimeOffset.UtcNow, "a search", action: "SEARCH");

        var (items, _) = await repository.GetAsync(new AuditQuery { Action = "VIEW" }, pageNumber: 1, pageSize: 10);

        Assert.Equal(["a profile view"], items.Select(i => i.Description));
    }

    /// <summary>
    /// The export covers the whole filtered set. The browser-built version it replaces re-fetched
    /// with <c>pageSize=1000</c>, which the list endpoint clamps to 100 — so "export everything" had
    /// always meant "export at most a hundred rows", with a filename that said otherwise.
    /// </summary>
    [Fact]
    public async Task An_export_is_not_limited_to_the_pages_the_list_endpoint_would_serve()
    {
        for (var i = 0; i < 150; i++)
        {
            await AddAsync(DateTimeOffset.UtcNow.AddMinutes(-i), $"row-{i}");
        }

        var matched = await repository.CountAsync(new AuditQuery());
        var rows = await repository.GetForExportAsync(new AuditQuery(), maxRows: 10_000);

        Assert.Equal(150, matched);
        Assert.Equal(150, rows.Count);
    }

    /// <summary>
    /// The cap is real, and the caller can tell it was hit. Silent truncation is what made every
    /// export on this platform untrustworthy.
    /// </summary>
    [Fact]
    public async Task An_export_that_hits_its_cap_still_reports_how_many_matched()
    {
        for (var i = 0; i < 10; i++)
        {
            await AddAsync(DateTimeOffset.UtcNow.AddMinutes(-i), $"row-{i}");
        }

        var matched = await repository.CountAsync(new AuditQuery());
        var rows = await repository.GetForExportAsync(new AuditQuery(), maxRows: 4);

        var export = new CsvExport("...", rows.Count, matched, 4);

        Assert.True(export.Truncated);
        Assert.Equal(4, export.RowCount);
        Assert.Equal(10, export.MatchCount);
    }

    /// <summary>
    /// Status, actor, customer and description were filtered in the browser over one fetched page,
    /// so a match on any other page could not be reached and the export ignored all four.
    /// </summary>
    [Fact]
    public async Task Status_actor_customer_and_description_are_applied_by_the_server_across_every_page()
    {
        for (var i = 0; i < 30; i++) await AddAsync(DateTimeOffset.UtcNow.AddMinutes(-i), $"noise-{i}");
        await AddAsync(DateTimeOffset.UtcNow.AddDays(-5), "Individual profile lookup failed (404).",
            action: "SEARCH", user: "Aiman Hakim", status: "Failure", customerName: "Tan Wei Ling", customerId: "S1234567A");

        var query = new AuditQuery { Status = "FAILED", Actor = "aiman", Customer = "s1234", Description = "LOOKUP FAILED" };
        var (items, total) = await repository.GetAsync(query, pageNumber: 1, pageSize: 10);

        Assert.Equal(1, total);
        Assert.Equal("Aiman Hakim", items.Single().User);
    }

    [Fact]
    public async Task Status_reads_an_unrecorded_outcome_as_a_success_as_the_screen_does()
    {
        await AddAsync(DateTimeOffset.UtcNow, "blank", status: "");
        await AddAsync(DateTimeOffset.UtcNow, "ok", status: "Success");
        await AddAsync(DateTimeOffset.UtcNow, "bad", status: "Failure");

        var (succeeded, _) = await repository.GetAsync(new AuditQuery { Status = "SUCCESS" }, 1, 10);
        var (failed, _) = await repository.GetAsync(new AuditQuery { Status = "FAILED" }, 1, 10);

        Assert.Equal(["blank", "ok"], succeeded.Select(i => i.Description).Order());
        Assert.Equal(["bad"], failed.Select(i => i.Description));
    }

    /// <summary>Rows from before the actor-name fix hold "User &lt;id&gt;"; they are found by that id.</summary>
    [Fact]
    public async Task An_actor_id_finds_rows_recorded_under_it()
    {
        var id = Guid.NewGuid();
        await AddAsync(DateTimeOffset.UtcNow, "legacy", user: $"User {id}", userId: id);
        await AddAsync(DateTimeOffset.UtcNow, "someone else");

        var (items, _) = await repository.GetAsync(new AuditQuery { Actor = id.ToString() }, 1, 10);

        Assert.Equal(["legacy"], items.Select(i => i.Description));
    }

    [Fact]
    public async Task The_export_count_and_rows_honour_the_same_filters_as_the_list()
    {
        await AddAsync(DateTimeOffset.UtcNow, "wanted", customerName: "Tan Wei Ling");
        await AddAsync(DateTimeOffset.UtcNow, "unwanted", customerName: "Rahman Ali");
        var query = new AuditQuery { Customer = "tan wei" };

        var (_, total) = await repository.GetAsync(query, 1, 10);
        var matched = await repository.CountAsync(query);
        var rows = await repository.GetForExportAsync(query, maxRows: 100);

        Assert.Equal(total, matched);
        Assert.Equal(["wanted"], rows.Select(r => r.Description));
        Assert.Equal("customer='tan wei'", query.Describe());
    }

    private async Task AddAsync(
        DateTimeOffset at, string description, string action = "VIEW_PROFILE", string user = "Priya Raman",
        string status = "Success", string? customerName = null, string? customerId = null, Guid? userId = null)
    {
        await repository.AddAsync(new AuditLog
        {
            Id = Guid.NewGuid().ToString(),
            Timestamp = at,
            User = user,
            UserId = userId,
            Action = action,
            Description = description,
            Status = status,
            CustomerName = customerName,
            CustomerId = customerId,
        });
    }
}
