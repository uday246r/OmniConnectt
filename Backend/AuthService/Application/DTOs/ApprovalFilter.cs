namespace AuthService.Application.DTOs;

/// <summary>
/// Everything the approval queue can be narrowed by — one shape for the list, the facets and the
/// export, for the same reason <see cref="AuditLogFilter"/> exists.
/// </summary>
/// <remarks>
/// <para>
/// The Approval Center fetched the newest 200 requests and applied action, maker, checker and record
/// filters to them in the browser, then paged the result client-side. Two things followed. A request
/// older than the newest 200 in its status could not be found at all, however exactly it was searched
/// for — indistinguishable from "no such request". And the export, which could only send the
/// filters the server understood, answered a broader question than the table it was launched from.
/// </para>
/// <para>
/// Every filter on that screen is a server-side predicate now, so the table, its row count, its
/// dropdown options and its CSV all describe the same set.
/// </para>
/// </remarks>
public sealed record ApprovalFilter
{
    public string? Module { get; init; }

    /// <summary>
    /// One status, or several comma-separated ("Approved,Rejected"). The Processed tab is the union of
    /// the two decided states; it used to issue two 200-row requests and merge them in the browser.
    /// </summary>
    public string? Status { get; init; }

    /// <summary>"Create", "Update", "Delete", "Enable" or "Disable". Exact.</summary>
    public string? Action { get; init; }

    public Guid? MakerId { get; init; }

    /// <summary>Set from the caller's own identity by the controller for "assigned to me" — never bound
    /// from the query string, so a caller cannot read someone else's queue by naming them.</summary>
    public Guid? CheckerId { get; init; }

    /// <summary>Case-insensitive substring of the maker's name, as the column shows it.</summary>
    public string? MakerName { get; init; }

    /// <summary>Case-insensitive substring of the checker's name.</summary>
    public string? CheckerName { get; init; }

    /// <summary>Case-insensitive substring of the record label ("jane@example.com", "Manager").</summary>
    public string? EntityLabel { get; init; }

    /// <summary>Bounds on when the request was RAISED.</summary>
    public DateTimeOffset? From { get; init; }
    public DateTimeOffset? To { get; init; }

    /// <summary>Bounds on when it was DECIDED.</summary>
    public DateTimeOffset? DecidedFrom { get; init; }
    public DateTimeOffset? DecidedTo { get; init; }

    /// <summary>
    /// "decided" orders by decision time, newest first, falling back to request time for anything
    /// still pending; anything else orders by request time. The Processed tab reads as a history of
    /// decisions, so it sorts by when they were made.
    /// </summary>
    public string? SortBy { get; init; }

    /// <summary>
    /// The filter as a sentence for the export's audit row, so the file can be reproduced from the
    /// trail. Names only what was set; "any" is implied for the rest.
    /// </summary>
    public string Describe()
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(Module)) parts.Add($"module={Module}");
        if (!string.IsNullOrWhiteSpace(Status)) parts.Add($"status={Status}");
        if (!string.IsNullOrWhiteSpace(Action)) parts.Add($"action={Action}");
        if (MakerId is not null) parts.Add($"makerId={MakerId}");
        if (CheckerId is not null) parts.Add($"checkerId={CheckerId}");
        if (!string.IsNullOrWhiteSpace(MakerName)) parts.Add($"maker~'{MakerName}'");
        if (!string.IsNullOrWhiteSpace(CheckerName)) parts.Add($"checker~'{CheckerName}'");
        if (!string.IsNullOrWhiteSpace(EntityLabel)) parts.Add($"record~'{EntityLabel}'");
        if (From is not null) parts.Add($"requestedFrom={From:O}");
        if (To is not null) parts.Add($"requestedTo={To:O}");
        if (DecidedFrom is not null) parts.Add($"decidedFrom={DecidedFrom:O}");
        if (DecidedTo is not null) parts.Add($"decidedTo={DecidedTo:O}");
        return parts.Count == 0 ? "Filters: none (the entire queue)." : $"Filters: {string.Join(", ", parts)}.";
    }

    /// <summary>The statuses named in <see cref="Status"/>, trimmed; empty when none were.</summary>
    public IReadOnlyList<string> Statuses =>
        string.IsNullOrWhiteSpace(Status)
            ? []
            : Status.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}

/// <summary>
/// The dropdown options for the Approval Center's bounded columns, under the other filters applied —
/// so every option offered returns at least one row.
/// </summary>
public sealed record ApprovalFacetsDto(
    IReadOnlyList<string> Modules,
    IReadOnlyList<string> Actions,
    IReadOnlyList<string> Makers,
    IReadOnlyList<string> Checkers);
