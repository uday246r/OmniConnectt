using AuthService.Application.DTOs;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// The Approval Center's query: every filter on that screen, applied by the server.
/// </summary>
/// <remarks>
/// The page used to fetch the newest 200 requests per status and filter action, maker, checker and
/// record in the browser. A request outside that window could not be found by any search, and the
/// export — which could only send the filters the server understood — described a broader set than
/// the table. These tests pin the server-side replacement: each filter narrows the list, the facets
/// and the export identically, and nothing depends on how many rows a page happened to load.
/// </remarks>
public class ApprovalQueueQueryTests : IDisposable
{
    private readonly ApprovalHarness h = new();
    private static readonly DateTimeOffset T0 = new(2026, 9, 1, 9, 0, 0, TimeSpan.Zero);

    public void Dispose() => h.Dispose();

    private async Task<ApprovalRequest> AddAsync(
        string label, string status = ApprovalStatus.Pending, string action = ApprovalActionKeys.Update,
        string module = "host.settings.users", string maker = "Asha Rao", string checker = "Ben Ito",
        int requestedDay = 0, int? decidedDay = null)
    {
        var request = new ApprovalRequest
        {
            Id = Guid.NewGuid(),
            Module = module,
            Action = action,
            EntityType = "User",
            EntityLabel = label,
            NewDataJson = "{}",
            Status = status,
            MakerId = Guid.NewGuid(),
            MakerName = maker,
            CheckerId = Guid.NewGuid(),
            CheckerName = checker,
            RequestedAt = T0.AddDays(requestedDay),
            DecidedAt = decidedDay is null ? null : T0.AddDays(decidedDay.Value),
        };
        h.Db.ApprovalRequests.Add(request);
        await h.Db.SaveChangesAsync();
        return request;
    }

    private async Task<List<string?>> LabelsAsync(ApprovalFilter filter, int page = 1, int pageSize = 100) =>
        (await h.Approvals.ListAsync(page, pageSize, filter)).Items.Select(i => i.EntityLabel).ToList();

    [Fact]
    public async Task A_request_older_than_any_page_window_is_still_found_by_searching_for_it()
    {
        for (var i = 0; i < 250; i++) await AddAsync($"recent-{i}", requestedDay: 10);
        await AddAsync("the-old-one", requestedDay: 0);

        var labels = await LabelsAsync(new ApprovalFilter { EntityLabel = "old-one" });

        Assert.Equal(["the-old-one"], labels);
    }

    [Fact]
    public async Task The_total_counts_every_match_not_the_page()
    {
        for (var i = 0; i < 30; i++) await AddAsync($"r{i}");

        var result = await h.Approvals.ListAsync(2, 10, new ApprovalFilter());

        Assert.Equal(30, result.Total);
        Assert.Equal(10, result.Items.Count);
    }

    [Fact]
    public async Task Action_is_matched_exactly()
    {
        await AddAsync("a", action: ApprovalActionKeys.Create);
        await AddAsync("b", action: ApprovalActionKeys.Delete);

        Assert.Equal(["a"], await LabelsAsync(new ApprovalFilter { Action = ApprovalActionKeys.Create }));
    }

    /// <summary>Postgres LIKE is case-sensitive; the browser's filter was not, and must not regress.</summary>
    [Fact]
    public async Task Maker_checker_and_record_searches_ignore_case_and_match_substrings()
    {
        await AddAsync("Jane.Doe@Example.com", maker: "Asha Rao", checker: "Ben Ito");
        await AddAsync("someone@else.com", maker: "Carl Moe", checker: "Dana Lee");

        Assert.Equal(["Jane.Doe@Example.com"], await LabelsAsync(new ApprovalFilter { MakerName = "asha" }));
        Assert.Equal(["Jane.Doe@Example.com"], await LabelsAsync(new ApprovalFilter { CheckerName = "ITO" }));
        Assert.Equal(["Jane.Doe@Example.com"], await LabelsAsync(new ApprovalFilter { EntityLabel = "jane.doe" }));
    }

    /// <summary>The Processed tab: one query for both decided states, instead of two 200-row fetches merged in the browser.</summary>
    [Fact]
    public async Task Several_statuses_can_be_asked_for_at_once()
    {
        await AddAsync("pending");
        await AddAsync("approved", ApprovalStatus.Approved, decidedDay: 1);
        await AddAsync("rejected", ApprovalStatus.Rejected, decidedDay: 2);

        var labels = await LabelsAsync(new ApprovalFilter { Status = "Approved, Rejected" });

        Assert.Equal(["approved", "rejected"], labels.Order().ToList());
    }

    [Fact]
    public async Task Sorting_by_decision_puts_the_most_recent_decision_first()
    {
        await AddAsync("decided-late", ApprovalStatus.Approved, requestedDay: 0, decidedDay: 9);
        await AddAsync("decided-early", ApprovalStatus.Rejected, requestedDay: 5, decidedDay: 6);

        var byDecision = await LabelsAsync(new ApprovalFilter { Status = "Approved,Rejected", SortBy = "decided" });
        var byRequest = await LabelsAsync(new ApprovalFilter { Status = "Approved,Rejected" });

        Assert.Equal(["decided-late", "decided-early"], byDecision);
        Assert.Equal(["decided-early", "decided-late"], byRequest);
    }

    [Fact]
    public async Task Requested_and_decided_ranges_are_independent_bounds()
    {
        await AddAsync("in-both", ApprovalStatus.Approved, requestedDay: 1, decidedDay: 3);
        await AddAsync("requested-in-decided-out", ApprovalStatus.Approved, requestedDay: 1, decidedDay: 8);
        await AddAsync("requested-out", ApprovalStatus.Approved, requestedDay: 6, decidedDay: 7);

        var labels = await LabelsAsync(new ApprovalFilter
        {
            From = T0, To = T0.AddDays(2),
            DecidedFrom = T0.AddDays(2), DecidedTo = T0.AddDays(4),
        });

        Assert.Equal(["in-both"], labels);
    }

    [Fact]
    public async Task Facets_offer_only_values_that_survive_the_other_filters()
    {
        await AddAsync("a", module: "host.settings.users", action: ApprovalActionKeys.Create, maker: "Asha Rao", checker: "Ben Ito");
        await AddAsync("b", module: "host.settings.roles", action: ApprovalActionKeys.Delete, maker: "Carl Moe", checker: "Dana Lee");

        var facets = await h.Approvals.FacetsAsync(new ApprovalFilter { Module = "host.settings.users" });

        Assert.Equal(["host.settings.users"], facets.Modules);
        Assert.Equal([ApprovalActionKeys.Create], facets.Actions);
        Assert.Equal(["Asha Rao"], facets.Makers);
        Assert.Equal(["Ben Ito"], facets.Checkers);
    }

    [Fact]
    public async Task The_export_contains_exactly_what_the_list_matches()
    {
        await AddAsync("keep-1", maker: "Asha Rao");
        await AddAsync("keep-2", maker: "asha rao");
        await AddAsync("drop", maker: "Carl Moe");
        var filter = new ApprovalFilter { MakerName = "Asha" };

        var list = await h.Approvals.ListAsync(1, 100, filter);
        var export = await h.Approvals.ExportCsvAsync(filter);

        Assert.Equal(list.Total, export.MatchCount);
        Assert.Equal(list.Total, export.RowCount);
        Assert.Contains("keep-1", export.Content);
        Assert.Contains("keep-2", export.Content);
        Assert.DoesNotContain("drop", export.Content);
    }

    [Fact]
    public void The_export_audit_row_can_reproduce_the_filter()
    {
        var described = new ApprovalFilter { Module = "host.settings.users", Status = "Approved,Rejected", MakerName = "asha" }.Describe();

        Assert.Equal("Filters: module=host.settings.users, status=Approved,Rejected, maker~'asha'.", described);
        Assert.Equal("Filters: none (the entire queue).", new ApprovalFilter().Describe());
    }
}
