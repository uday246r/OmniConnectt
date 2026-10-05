using System.Text.RegularExpressions;

namespace AuthService.Application.Remotes;

/// <summary>
/// The small part of npm's SemVer range language the platform uses to say "this remote works with
/// that host bridge": <c>^1.2.0</c>, <c>~1.2.0</c>, <c>1.2.0</c>, <c>&gt;=1.2.0</c>, <c>1.x</c>, <c>*</c>,
/// and space-separated conjunctions such as <c>&gt;=1.2.0 &lt;3.0.0</c>.
/// </summary>
/// <remarks>
/// The host checks the same ranges in the browser (packages/host-bridge, semver.ts) before mounting a
/// remote; this side refuses to promote an incompatible one in the first place. Both run the shared
/// table in Frontend/packages/host-bridge/src/__fixtures__/semver-parity.json, so the two can never
/// disagree about whether a remote may load. Pre-release tags are ignored on purpose: the bridge is
/// versioned in plain MAJOR.MINOR.PATCH.
/// </remarks>
public static partial class SemVerRange
{
    [GeneratedRegex(@"^v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:[-+].*)?$")]
    private static partial Regex VersionPattern();

    /// <summary>
    /// True when <paramref name="version"/> satisfies <paramref name="range"/>. A malformed version or
    /// range is never satisfied — an unreadable compatibility claim must not be read as "compatible".
    /// </summary>
    public static bool Satisfies(string version, string range)
    {
        if (!TryParse(version, out var v, out _)) return false;

        var parts = range.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0) return false;

        foreach (var part in parts)
        {
            if (!SatisfiesOne(v, part)) return false;
        }
        return true;
    }

    private static bool SatisfiesOne((int Major, int Minor, int Patch) v, string comparator)
    {
        if (comparator is "*" or "x" or "X") return true;

        string op;
        string rest;
        if (comparator.StartsWith(">=") || comparator.StartsWith("<=")) { op = comparator[..2]; rest = comparator[2..]; }
        else if (comparator[0] is '^' or '~' or '>' or '<' or '=') { op = comparator[..1]; rest = comparator[1..]; }
        else { op = ""; rest = comparator; }

        if (!TryParse(rest, out var b, out var specified)) return false;

        var cmp = Compare(v, b);
        return op switch
        {
            ">=" => cmp >= 0,
            "<=" => cmp <= 0,
            ">" => cmp > 0,
            "<" => cmp < 0,
            // npm caret: the left-most non-zero component (or the last one given) may not change.
            "^" => cmp >= 0 && (b.Major > 0 || specified == 1
                ? v.Major == b.Major
                : b.Minor > 0 || specified == 2
                    ? v.Major == 0 && v.Minor == b.Minor
                    : v.Major == 0 && v.Minor == 0 && v.Patch == b.Patch),
            "~" => cmp >= 0 && v.Major == b.Major && (specified < 2 || v.Minor == b.Minor),
            // Bare or "=": a partial version ("1", "1.2", "1.x") matches everything it leaves open.
            _ => specified switch
            {
                1 => v.Major == b.Major,
                2 => v.Major == b.Major && v.Minor == b.Minor,
                _ => cmp == 0,
            },
        };
    }

    private static int Compare((int Major, int Minor, int Patch) a, (int Major, int Minor, int Patch) b) =>
        a.Major != b.Major ? a.Major.CompareTo(b.Major)
        : a.Minor != b.Minor ? a.Minor.CompareTo(b.Minor)
        : a.Patch.CompareTo(b.Patch);

    /// <summary><paramref name="specified"/> counts the numeric components given (1-3); x/* count as unspecified.</summary>
    private static bool TryParse(string text, out (int Major, int Minor, int Patch) version, out int specified)
    {
        version = default;
        specified = 0;
        var match = VersionPattern().Match(text.Trim());
        if (!match.Success) return false;

        static int? Part(Group g) => g.Success && int.TryParse(g.Value, out var n) ? n : null;
        var major = Part(match.Groups[1]);
        var minor = Part(match.Groups[2]);
        var patch = Part(match.Groups[3]);
        if (major is null) return false;

        specified = minor is null ? 1 : patch is null ? 2 : 3;
        version = (major.Value, minor ?? 0, patch ?? 0);
        return true;
    }
}
