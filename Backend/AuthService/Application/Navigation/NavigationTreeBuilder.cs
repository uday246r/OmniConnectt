using AuthService.Application.DTOs;

namespace AuthService.Application.Navigation;

/// <summary>
/// Turns the catalog and one user's permissions into the sidebar they should see. Pure — no
/// DbContext, no clock of its own, no HTTP — so the filtering rules can be tested exhaustively.
/// </summary>
public static class NavigationTreeBuilder
{
    private const string StateVisible = "visible";
    private const string StateMaintenance = "maintenance";
    private const string StateMaintenanceBypass = "maintenance-bypass";

    /// <summary>Opening an app that is in maintenance. Administrators hold it implicitly.</summary>
    public const string MaintenanceBypassPermission = "host.settings.applications:MaintenanceBypass";
    private const string RemotePrefix = "remote.";

    /// <summary>
    /// The section remote apps are placed in.
    /// <para>
    /// The one navigation constant left in code, and deliberately so: "a remote app is an app" is a
    /// structural fact about the platform, not something an operator configures. Everything an
    /// operator might reasonably want to change — the section's label, its order, whether it pins to
    /// the bottom, and every host row's label, icon, route and order — is seeded data.
    /// </para>
    /// </summary>
    public const string AppsSectionKey = "apps";

    /// <summary>
    /// Gate order, first match wins, parents evaluated before their children:
    /// <list type="number">
    /// <item>registered — an inactive feature, or a remote app with no render metadata, is omitted</item>
    /// <item>active — status Disabled is omitted</item>
    /// <item>maintenance — status Maintenance renders with its message</item>
    /// <item>permission — applied last, as an omit-gate over every state above</item>
    /// </list>
    /// <para>
    /// Permission being an omit-gate rather than a state matters: a row the caller may not use is
    /// absent from the response entirely, never rendered as a disabled hint, because sending it would
    /// tell every user which modules the product contains.
    /// </para>
    /// </summary>
    public static IReadOnlyList<NavSectionDto> Build(
        NavigationCatalogSnapshot catalog,
        IReadOnlySet<string> permissions,
        bool isAdministrator)
    {
        var itemsBySection = catalog.Sections
            .ToDictionary(s => s.Key, _ => new List<NavNodeDto>(), StringComparer.OrdinalIgnoreCase);

        foreach (var entry in catalog.HostItems.OrderBy(e => e.SortOrder))
        {
            if (!isAdministrator && !HasPermission(entry.RequiredFeatureKey, entry.RequiredCapability, permissions))
            {
                continue;
            }

            if (!itemsBySection.TryGetValue(entry.SectionKey, out var bucket))
            {
                // A row pointing at a section that no longer exists is dropped rather than crashing
                // the whole sidebar for everyone.
                continue;
            }

            bucket.Add(new NavNodeDto(
                entry.Key, entry.Label, entry.IconKey, entry.RoutePath,
                Page: null, entry.SortOrder, Kind: "host",
                StateVisible, MaintenanceMessage: null, Remote: null, Children: []));
        }

        if (itemsBySection.TryGetValue(AppsSectionKey, out var appsBucket))
        {
            foreach (var app in catalog.Features
                         .Where(f => f.ParentKey is null && f.Key.StartsWith(RemotePrefix, StringComparison.Ordinal))
                         .OrderBy(f => f.SortOrder).ThenBy(f => f.DisplayName, StringComparer.Ordinal))
            {
                var node = BuildAppNode(app, catalog, permissions, isAdministrator);
                if (node is not null)
                {
                    appsBucket.Add(node);
                }
            }
        }

        return catalog.Sections
            .OrderBy(s => s.PinToBottom).ThenBy(s => s.SortOrder)
            .Select(s => new NavSectionDto(s.Key, s.Label, s.SortOrder, s.PinToBottom, itemsBySection[s.Key]))
            // An empty section is dropped rather than rendered as a bare heading with nothing under it.
            .Where(s => s.Items.Count > 0)
            .ToList();
    }

    private static NavNodeDto? BuildAppNode(
        NavFeature app,
        NavigationCatalogSnapshot catalog,
        IReadOnlySet<string> permissions,
        bool isAdministrator)
    {
        // Gate 1. A remote app with no replicated render metadata cannot be mounted, so it is not
        // navigation yet — it is a half-finished sync.
        if (!app.IsActive) return null;
        if (!catalog.RenderByFeatureKey.TryGetValue(app.Key, out var render)) return null;

        // Gate 2.
        if (string.Equals(render.Status, "Disabled", StringComparison.OrdinalIgnoreCase)) return null;

        // Gate 3.
        var state = StateVisible;
        string? maintenanceMessage = null;
        if (string.Equals(render.Status, "Maintenance", StringComparison.OrdinalIgnoreCase))
        {
            state = isAdministrator || permissions.Contains(MaintenanceBypassPermission)
                ? StateMaintenanceBypass
                : StateMaintenance;
            maintenanceMessage = render.MaintenanceMessage;
        }

        var appKey = app.Key[RemotePrefix.Length..];
        var children = new List<NavNodeDto>();

        foreach (var module in catalog.Features
                     .Where(f => f.ParentKey == app.Key && f.IsActive)
                     .OrderBy(f => f.SortOrder).ThenBy(f => f.DisplayName, StringComparer.Ordinal))
        {
            if (!catalog.NavItemsByFeatureKey.TryGetValue(module.Key, out var rows)) continue;

            foreach (var row in rows.OrderBy(r => r.SortOrder).ThenBy(r => r.Label, StringComparer.Ordinal))
            {
                if (!isAdministrator && !HasPermission(module.Key, row.RequiredCapability, permissions))
                {
                    continue;
                }

                children.Add(new NavNodeDto(
                    // Not the feature key: one feature owns several rows, so the feature key alone
                    // would collide as a React key and as an active-route id.
                    $"{module.Key}#{row.NavKey}",
                    row.Label,
                    row.IconKey,
                    $"/apps/{appKey}/{row.RouteSegment}",
                    Page: row.RouteSegment,
                    row.SortOrder,
                    Kind: "submodule",
                    state,
                    state == StateVisible ? null : maintenanceMessage,
                    Remote: null,
                    Children: []));
            }
        }

        // Gate 4 for the app row itself. It survives if the caller holds a capability on the app
        // directly OR on any of its sub-modules — the two-prefix rule, because a sub-module
        // permission ("remote.lead.lead:View") does not start with "remote.lead:".
        var hasOwnPermission = isAdministrator || permissions.Any(p =>
            p.StartsWith($"{app.Key}:", StringComparison.OrdinalIgnoreCase) ||
            p.StartsWith($"{app.Key}.", StringComparison.OrdinalIgnoreCase));

        if (children.Count == 0 && !hasOwnPermission) return null;

        return new NavNodeDto(
            app.Key,
            app.DisplayName,
            render.IconKey,
            $"/apps/{appKey}",
            Page: null,
            app.SortOrder,
            Kind: "remote-app",
            state,
            maintenanceMessage,
            // DefaultRoutePath is the first surviving child, so /apps/lead never lands on a blank
            // frame when the remote's own first page is one the caller cannot see.
            new RemoteMountDto(
                appKey,
                state == StateMaintenance ? null : render.ManifestUrl,
                render.ContainerName,
                children.FirstOrDefault()?.RoutePath),
            children);
    }

    /// <summary>
    /// Gate 4. A null feature key means the row is ungated; a null capability means any capability on
    /// the feature is enough, which is the right default for a module whose single page is its whole
    /// surface.
    /// </summary>
    private static bool HasPermission(string? featureKey, string? capability, IReadOnlySet<string> permissions)
    {
        if (featureKey is null) return true;

        if (capability is not null)
        {
            return permissions.Contains($"{featureKey}:{capability}");
        }

        return permissions.Any(p => p.StartsWith($"{featureKey}:", StringComparison.OrdinalIgnoreCase));
    }
}
