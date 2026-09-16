using System.Text.RegularExpressions;
using AuthService.Application.DTOs;

namespace AuthService.Application.Navigation;

/// <summary>
/// What a page-view row says about the page, decided entirely on the server.
/// </summary>
/// <param name="Path">The normalised route, which is also the dedupe key.</param>
/// <param name="Application">"Host", or the remote app's display name.</param>
/// <param name="Module">The row's label as the sidebar shows it, e.g. "Create Lead".</param>
/// <param name="PageKey">Stable page id for the Page column, e.g. "create-lead" or "system/audit-logs".</param>
/// <param name="Description">The plain-language headline, e.g. "Opened Lead Management → Create Lead."</param>
/// <param name="UserId">Set for a user's profile page, so the view also shows up in that user's own audit tab.</param>
public sealed record ResolvedPage(
    string Path,
    string Application,
    string Module,
    string PageKey,
    string Description,
    Guid? UserId = null);

/// <summary>
/// Turns a route the browser says it opened into a page the caller may actually open — or nothing.
/// </summary>
/// <remarks>
/// <para>
/// This is what makes page views evidence rather than hearsay. The old <c>POST /api/audit-logs/activity</c>
/// wrote whatever application, module and action the client named. Here the client names only a path,
/// and every label on the row comes from the caller's own navigation tree — the same tree, built from
/// the same token, that decides what their sidebar shows. A path that is not in that tree is refused,
/// so a user cannot record a visit to a page they are not allowed to open, or invent a page that does
/// not exist.
/// </para>
/// <para>
/// A handful of host pages are reached from places other than the sidebar (the profile menu, the
/// Users list, the settings drawer). They are listed in <see cref="HostPages"/> with the permission
/// each requires, mirroring the guards on the host's routes.
/// </para>
/// </remarks>
public static class PageViewResolver
{
    public const string HostApplication = "Host";

    /// <summary>Generous for any real route and far below anything worth storing.</summary>
    public const int MaxPathLength = 200;

    private static readonly Regex AllowedPath = new("^/[A-Za-z0-9/_-]*$", RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(50));

    private sealed record HostPage(Regex Pattern, string Label, string PageKey, string? FeatureKey, string? Capability, bool IsUserProfile = false);

    private static readonly HostPage[] HostPages =
    [
        new(Exact("/profile"), "My Profile", "profile", null, null),
        new(Exact("/settings/users"), "Users", "settings/users", "host.settings.users", "View"),
        new(new Regex("^/settings/users/(?<id>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$",
                RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(50)),
            "User details", "settings/users/details", "host.settings.users", "View", IsUserProfile: true),
        new(Exact("/settings/roles"), "Roles", "settings/roles", "host.settings.roles", "View"),
        new(Exact("/settings/applications"), "Applications", "settings/applications", "host.settings.applications", "View"),
        new(Exact("/settings/checker-assignment"), "Checker Assignment", "settings/checker-assignment", "host.system.checker-assignment", "View"),
    ];

    /// <summary>
    /// The path in the one form rows are stored and deduplicated under, or null when it is not a route
    /// at all (a full URL, a query string, "..", characters no route uses).
    /// </summary>
    public static string? Normalize(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return null;

        var trimmed = path.Trim();
        if (trimmed.Length > MaxPathLength || !AllowedPath.IsMatch(trimmed) || trimmed.Contains("//", StringComparison.Ordinal))
        {
            return null;
        }

        return trimmed.Length > 1 ? trimmed.TrimEnd('/').ToLowerInvariant() : "/";
    }

    /// <param name="tree">The caller's navigation tree, already filtered by their permissions.</param>
    public static ResolvedPage? Resolve(
        IReadOnlyList<NavSectionDto> tree,
        string? path,
        IReadOnlySet<string> permissions,
        bool isAdministrator)
    {
        var normalized = Normalize(path);
        if (normalized is null) return null;

        foreach (var node in tree.SelectMany(s => s.Items))
        {
            if (Matches(node, normalized))
            {
                return node.Kind == "remote-app"
                    ? Remote(normalized, node, node)
                    : Host(normalized, node.Label, node.RoutePath.Trim('/') is { Length: > 0 } key ? key : "dashboard");
            }

            foreach (var child in node.Children)
            {
                if (Matches(child, normalized))
                {
                    return Remote(normalized, node, child);
                }
            }
        }

        foreach (var page in HostPages)
        {
            var match = page.Pattern.Match(normalized);
            if (!match.Success) continue;

            if (!isAdministrator && page.FeatureKey is not null &&
                !permissions.Contains($"{page.FeatureKey}:{page.Capability}"))
            {
                return null;
            }

            Guid? userId = page.IsUserProfile && Guid.TryParse(match.Groups["id"].Value, out var id) ? id : null;
            return Host(normalized, page.Label, page.PageKey) with { UserId = userId };
        }

        return null;
    }

    private static bool Matches(NavNodeDto node, string normalized) =>
        string.Equals(node.RoutePath.TrimEnd('/') is { Length: > 0 } route ? route : "/", normalized, StringComparison.OrdinalIgnoreCase);

    private static ResolvedPage Host(string path, string label, string pageKey) =>
        new(path, HostApplication, label, pageKey, $"Opened {label}.");

    private static ResolvedPage Remote(string path, NavNodeDto app, NavNodeDto page) =>
        ReferenceEquals(app, page)
            ? new(path, app.Label, app.Label, app.Remote?.AppKey ?? app.Key, $"Opened {app.Label}.")
            : new(path, app.Label, page.Label, page.Page ?? page.Key, $"Opened {app.Label} → {page.Label}.");

    private static Regex Exact(string route) =>
        new($"^{Regex.Escape(route)}$", RegexOptions.CultureInvariant | RegexOptions.IgnoreCase, TimeSpan.FromMilliseconds(50));
}
