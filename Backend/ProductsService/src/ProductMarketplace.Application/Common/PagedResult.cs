namespace ProductMarketplace.Application.Common;

public class PagedResult<T>
{
    public IReadOnlyList<T> Items { get; set; } = Array.Empty<T>();
    public int Page { get; set; }
    public int PageSize { get; set; }
    public int TotalCount { get; set; }
    public int TotalPages => PageSize == 0 ? 0 : (int)Math.Ceiling(TotalCount / (double)PageSize);
}

public class PagingQuery
{
    private int _page = 1;
    private int _pageSize = 8;

    public int Page
    {
        get => _page;
        set => _page = value < 1 ? 1 : value;
    }

    public int PageSize
    {
        get => _pageSize;
        set => _pageSize = value < 1 ? 8 : Math.Min(value, 100);
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
