namespace ProductMarketplace.Application.Common;

public class PagedResult<T>
{
    public IReadOnlyList<T> Items { get; set; } = Array.Empty<T>();
    public int Page { get; set; }
    public int PageSize { get; set; }
    public int TotalCount { get; set; }
    public int TotalPages => PageSize == 0 ? 0 : (int)Math.Ceiling(TotalCount / (double)PageSize);
}

/// <summary>
/// The one place a list query's page and page size are read and clamped.
/// </summary>
/// <remarks>
/// Every list endpoint used to re-implement this, each with its own default, so a caller could not tell
/// what a list would return without reading its DTO. A list derives from this and overrides
/// <see cref="DefaultPageSize"/> if 10 is not right for it.
/// </remarks>
public abstract class PagingQuery
{
    private int _page = 1;
    private int? _pageSize;

    protected virtual int DefaultPageSize => 10;

    /// <summary>1 or greater; anything lower is read as the first page rather than failing with a negative offset.</summary>
    public int Page
    {
        get => _page;
        set => _page = value < 1 ? 1 : value;
    }

    /// <summary>Between 1 and <see cref="Paging.MaxPageSize"/>, so no caller can ask for the whole table in one response.</summary>
    public int PageSize
    {
        get => _pageSize ?? DefaultPageSize;
        set => _pageSize = Paging.Clamp(value, DefaultPageSize);
    }
}

/// <summary>The paging limits every list endpoint in this service shares.</summary>
public static class Paging
{
    /// <summary>
    /// The largest page any list returns. Page sizes used to be taken as given, so one request for
    /// pageSize=1000000 made the database read the whole table into memory — a cheap request that is
    /// expensive to serve. 100 matches every other service on the platform.
    /// </summary>
    public const int MaxPageSize = 100;

    /// <summary>A non-positive size falls back to the list's own default; anything above the cap is capped.</summary>
    public static int Clamp(int requested, int fallback) =>
        requested < 1 ? fallback : Math.Min(requested, MaxPageSize);

    /// <summary>For "top N" style endpoints.</summary>
    public const int MaxTake = 50;

    public static int ClampTake(int requested, int fallback) =>
        requested < 1 ? fallback : Math.Min(requested, MaxTake);
}
