using ProductMarketplace.Application.Common;

namespace ProductMarketplace.Api.Infrastructure;

/// <summary>
/// Puts an export's row counts on the response so the browser can tell the operator when a file is
/// incomplete.
/// </summary>
/// <remarks>
/// <para>
/// A truncated export cannot be signalled in the body — the body is the CSV. Headers are the only
/// channel available, and the alternative was what every export on this platform did before: return
/// a 200 with a partial file and let the operator assume it was whole.
/// </para>
/// <para>
/// These are invisible to <c>fetch</c> unless CORS exposes them. Every service that serves an export
/// must list all four in its <c>WithExposedHeaders</c>, or the download still works and the
/// truncation warning silently never fires — which is the original bug with extra steps.
/// </para>
/// </remarks>
public static class ExportHeaders
{
    public const string RowCount = "X-Export-Row-Count";
    public const string MatchCount = "X-Export-Match-Count";
    public const string RowLimit = "X-Export-Row-Limit";
    public const string Truncated = "X-Export-Truncated";

    /// <summary>Every header a browser has to be allowed to read for the warning to work.</summary>
    public static readonly string[] All = [RowCount, MatchCount, RowLimit, Truncated, "Content-Disposition"];

    public static void Apply(HttpResponse response, CsvExport export)
    {
        response.Headers[RowCount] = export.RowCount.ToString();
        response.Headers[MatchCount] = export.MatchCount.ToString();
        response.Headers[RowLimit] = export.RowLimit.ToString();
        response.Headers[Truncated] = export.Truncated ? "true" : "false";
    }
}
