namespace AuthService.Application.DTOs;

/// <summary>
/// Everything the Users directory can be narrowed by, applied by the database.
/// </summary>
/// <remarks>
/// The Users page used to load one "pool" of users — it asked for 200, the endpoint allows 100 — and
/// filtered, counted and paged that pool in the browser. A directory past 100 accounts was silently
/// truncated: the rest could not be found by any search, and the counts described the sample. Every
/// filter the page offers is a server predicate now, so the table, its row count and its dropdown
/// options all describe the whole directory.
/// </remarks>
public sealed record UserListFilter
{
    /// <summary>Quick search: name, email, role, or digits of the mobile number.</summary>
    public string? Search { get; init; }

    /// <summary>Name or email contains this text.</summary>
    public string? Name { get; init; }

    /// <summary>Digits the mobile number contains, ignoring its formatting ("+60 12-345" matches "6012345").</summary>
    public string? Phone { get; init; }

    /// <summary>A role as the list shows it: the role's exact name, or "No Role" for users without one.</summary>
    public string? Role { get; init; }

    public Guid? RoleId { get; init; }

    public bool? IsActive { get; init; }

    /// <summary>Last sign-in on or after this instant. A user who never signed in does not match a bounded range.</summary>
    public DateTimeOffset? LastLoginFrom { get; init; }

    public DateTimeOffset? LastLoginTo { get; init; }
}

/// <summary>The whole directory's headline counts — unaffected by the filters, as the cards above the table show.</summary>
public sealed record UserDirectorySummaryDto(int Total, int Active, int Inactive, int Administrators);

/// <summary>The role values the Role filter can offer: every role some user holds, plus "No Role" when any user has none.</summary>
public sealed record UserListFacetsDto(IReadOnlyList<string> Roles);
