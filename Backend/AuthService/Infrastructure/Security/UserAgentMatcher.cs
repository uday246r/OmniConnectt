namespace AuthService.Infrastructure.Security;

/// <summary>
/// Turns a browser or OS name — as the audit drawer displays it — into the raw User-Agent substrings
/// that produce it.
/// </summary>
/// <remarks>
/// <para>
/// The Device filter used to run in the browser, over values already parsed out of the header by
/// <c>parseUserAgent</c>. Moving it server-side means matching those display names against the raw
/// string, and several of them do not appear in it: a Mac says <c>Macintosh; Intel Mac OS X</c> and
/// never "macOS", an iPhone says <c>iPhone</c> and never "iOS", and Edge identifies itself as
/// <c>Edg/</c> — while also containing "Chrome", which is why the browser rules are ordered.
/// A naive <c>Contains</c> would silently return nothing for macOS, iOS and Edge, and would return
/// every Edge session under Chrome.
/// </para>
/// <para>
/// This is the second hand-maintained copy of that heuristic, and the honest cost of moving the
/// filter server-side. <c>UserAgentMatcherTests</c> walks the same table both sides read from, so
/// the two drifting apart fails a test rather than quietly narrowing a filter.
/// </para>
/// </remarks>
public static class UserAgentMatcher
{
    /// <summary>
    /// Display name → the substrings whose presence means that name, in the order the frontend's
    /// parser evaluates them. Anything not listed falls through to a plain substring match, which is
    /// correct for the names that ARE literal ("Chrome", "Firefox", "Windows", "Android", "Linux").
    /// </summary>
    private static readonly Dictionary<string, string[]> Aliases = new(StringComparer.OrdinalIgnoreCase)
    {
        ["macOS"] = ["Mac OS X", "Macintosh"],
        ["iOS"] = ["iPhone", "iPad"],
        ["Edge"] = ["Edg/"],
        ["Windows 10/11"] = ["Windows NT 10.0", "Windows NT 11"],
    };

    /// <summary>
    /// The substrings a row's User-Agent must contain one of to match <paramref name="displayName"/>.
    /// Never empty — an unrecognised name matches itself, so a value this table has not learned about
    /// still filters on something reasonable rather than on nothing.
    /// </summary>
    public static IReadOnlyList<string> SubstringsFor(string displayName) =>
        Aliases.TryGetValue(displayName.Trim(), out var aliases) ? aliases : [displayName.Trim()];

    /// <summary>
    /// Whether a raw header matches a display name. Used by the tests that pin this against the
    /// frontend parser; the query itself expands to SQL through <see cref="SubstringsFor"/>, because
    /// EF cannot translate a call to this method.
    /// </summary>
    public static bool Matches(string? userAgent, string displayName)
    {
        if (string.IsNullOrEmpty(userAgent))
        {
            return false;
        }

        // Edge announces itself as Chrome as well, so "Chrome" must not swallow Edge sessions —
        // exactly the ordering the frontend parser applies when it checks Edg/ before Chrome/.
        if (displayName.Equals("Chrome", StringComparison.OrdinalIgnoreCase)
            && userAgent.Contains("Edg/", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return SubstringsFor(displayName)
            .Any(s => userAgent.Contains(s, StringComparison.OrdinalIgnoreCase));
    }
}
