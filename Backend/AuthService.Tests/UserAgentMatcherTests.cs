using AuthService.Infrastructure.Security;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// The Device filter's server side, and its agreement with the browser parser that produces the
/// names it matches on.
/// </summary>
/// <remarks>
/// <para>
/// The Audit Logs page shows a Device column derived from the raw User-Agent by
/// <c>parseUserAgent</c> in <c>AuditLogDetailDrawer.tsx</c>, and used to filter that column in the
/// browser over the rows it had already fetched. Moving the filter server-side means matching those
/// DISPLAY names against the raw header — and several of them do not appear in it. A Mac says
/// "Macintosh; Intel Mac OS X" and never "macOS"; an iPhone says "iPhone" and never "iOS"; Edge says
/// "Edg/" while also saying "Chrome".
/// </para>
/// <para>
/// So there are now two hand-maintained copies of one heuristic, in two languages, and they will
/// drift unless something makes them fail together. This is that something: the table below is the
/// same set of cases the frontend parser is written against, and it fails the moment the server's
/// mapping stops producing what the screen displays.
/// </para>
/// </remarks>
public class UserAgentMatcherTests
{
    private const string Chrome =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    private const string Edge =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";

    private const string SafariOnMac =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

    private const string SafariOnIPhone =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

    private const string FirefoxOnLinux =
        "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0";

    /// <summary>
    /// The names the drawer displays, against the headers that produce them. Each row is a case the
    /// operator can actually pick from the Device filter.
    /// </summary>
    [Theory]
    // The names that ARE literal substrings — the easy half, included so a regression that breaks
    // the simple path is caught too.
    [InlineData("Chrome", Chrome, true)]
    [InlineData("Firefox", FirefoxOnLinux, true)]
    [InlineData("Windows", Chrome, true)]
    [InlineData("Linux", FirefoxOnLinux, true)]
    // The names that are NOT, and would silently match nothing under a plain Contains.
    [InlineData("macOS", SafariOnMac, true)]
    [InlineData("iOS", SafariOnIPhone, true)]
    [InlineData("Edge", Edge, true)]
    [InlineData("Windows 10/11", Chrome, true)]
    // And the negatives, which are what stop a filter from over-matching.
    [InlineData("macOS", Chrome, false)]
    [InlineData("iOS", SafariOnMac, false)]
    [InlineData("Firefox", Chrome, false)]
    [InlineData("Linux", SafariOnMac, false)]
    public void A_display_name_matches_exactly_the_user_agents_that_produce_it(
        string displayName, string userAgent, bool expected)
    {
        Assert.Equal(expected, UserAgentMatcher.Matches(userAgent, displayName));
    }

    /// <summary>
    /// Edge announces itself as Chrome as well, which is why the frontend parser checks <c>Edg/</c>
    /// first. Without the same ordering here, an operator filtering to Chrome would be shown every
    /// Edge session too — a filter that quietly returns more than it says.
    /// </summary>
    [Fact]
    public void Filtering_to_Chrome_does_not_also_return_Edge_sessions()
    {
        Assert.True(UserAgentMatcher.Matches(Chrome, "Chrome"));
        Assert.False(UserAgentMatcher.Matches(Edge, "Chrome"));
        Assert.True(UserAgentMatcher.Matches(Edge, "Edge"));
    }

    /// <summary>
    /// A row with no recorded User-Agent — an internal service call, a background write — matches no
    /// device rather than every device.
    /// </summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void A_row_with_no_user_agent_matches_nothing(string? userAgent)
    {
        Assert.False(UserAgentMatcher.Matches(userAgent, "Chrome"));
    }

    /// <summary>
    /// A name the table has not learned about falls back to matching itself. Narrowing to nothing
    /// would be defensible too; matching itself is the more useful of the two, because a new browser
    /// name is usually a literal substring of the header that produced it.
    /// </summary>
    [Fact]
    public void An_unrecognised_name_falls_back_to_matching_itself()
    {
        Assert.Equal(["Brave"], UserAgentMatcher.SubstringsFor("Brave"));
        Assert.True(UserAgentMatcher.Matches("Mozilla/5.0 … Brave/1.60", "Brave"));
    }
}
