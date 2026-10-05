using System.Text.RegularExpressions;
using AuthService.Application.Exceptions;

namespace AuthService.Application.Remotes;

/// <summary>
/// The one rule for what a remote app's manifest URL may be, applied to every write — the admin form,
/// an approval replay, and a release promotion alike.
/// </summary>
/// <remarks>
/// <para>
/// The normal shape is root-relative and versioned: <c>/modules/lead/4.7.3/mf-manifest.json</c>. The
/// key segment must be the app's own key, so one app's registration can never point at another app's
/// files; the version segment is what makes each published build immutable, so a user who already
/// has a version open keeps loading that version's chunks after a newer one is promoted.
/// </para>
/// <para>
/// An absolute URL is accepted only where <paramref name="allowAbsolute"/> says so (development), and
/// then only http/https. The scheme check is not decoration: on Linux, <c>Uri.TryCreate("/modules/x",
/// UriKind.Absolute)</c> succeeds as a <c>file://</c> URI, so "is it absolute?" alone let a relative path
/// through as if it were a full URL, only to fail later inside HttpClient.
/// </para>
/// </remarks>
public static partial class ManifestUrlPolicy
{
    /// <summary>The version folder: SemVer-ish, or "dev" for a local build server.</summary>
    [GeneratedRegex(@"^/modules/(?<key>[a-z][a-z0-9-]{1,49})/(?<version>[A-Za-z0-9][A-Za-z0-9._+-]{0,63})/mf-manifest\.json$")]
    private static partial Regex RelativePattern();

    /// <summary>
    /// The trimmed URL, or a <see cref="ValidationAppException"/> naming exactly what is wrong with it.
    /// </summary>
    public static string Normalize(string? value, string appKey, bool allowAbsolute)
    {
        var url = value?.Trim() ?? string.Empty;
        if (url.Length == 0)
        {
            throw new ValidationAppException("Manifest URL is required.");
        }

        if (url.StartsWith('/'))
        {
            var match = RelativePattern().Match(url);
            if (!match.Success)
            {
                throw new ValidationAppException(
                    $"Manifest URL must look like /modules/{appKey}/<version>/mf-manifest.json.");
            }

            if (!string.Equals(match.Groups["key"].Value, appKey, StringComparison.Ordinal))
            {
                throw new ValidationAppException(
                    $"Manifest URL must be under /modules/{appKey}/ — an app can only be served from its own folder.");
            }

            return url;
        }

        if (!allowAbsolute)
        {
            throw new ValidationAppException(
                $"Manifest URL must be a path on this platform, like /modules/{appKey}/<version>/mf-manifest.json. "
                + "Absolute URLs are only accepted in development.");
        }

        if (!IsHttpUrl(url))
        {
            throw new ValidationAppException("Manifest URL must be an http or https URL to an mf-manifest.json.");
        }

        return url;
    }

    /// <summary>The version folder of a relative manifest URL, or null for an absolute one.</summary>
    public static string? VersionOf(string manifestUrl)
    {
        var match = RelativePattern().Match(manifestUrl);
        return match.Success ? match.Groups["version"].Value : null;
    }

    /// <summary>The canonical manifest path for one version of an app.</summary>
    public static string ForVersion(string appKey, string version) => $"/modules/{appKey}/{version}/mf-manifest.json";

    /// <summary>An absolute http(s) URL — what server-to-server addresses (a permissions source) must be.</summary>
    public static bool IsHttpUrl(string value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps)
        && !string.IsNullOrEmpty(uri.Host);
}
