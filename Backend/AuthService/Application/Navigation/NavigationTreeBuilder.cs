using AuthService.Application.DTOs;
using AuthService.Application.Entitlements;

namespace AuthService.Application.Navigation;

/// <summary>
/// Turns the catalog, the entitlement map and one user's permissions into the sidebar they should
/// see. Pure — no DbContext, no clock, no HTTP — so the precedence rules can be tested exhaustively,
/// which matters because getting them wrong either hides something a customer paid for or advertises
/// something they should not know exists.
/// </summary>
public static class NavigationTreeBuilder
{
    private const string StateVisible = "visible";
    private const string StateLocked = "locked";
    private const string StateMaintenance = "maintenance";
    private const string RemotePrefix = "remote.";

    /// <summary>
    /// Gate order, first match wins, parents evaluated before their children:
    /// <list type="number">
    /// <item>registered — inactive feature, or a remote app with no render metadata, is omitted</item>
    /// <item>active — status Disabled is omitted</item>
    /// <item>licensed — unlicensed becomes locked, or omitted when the entitlement says Hidden</item>
    /// <item>locked/hidden override — an explicit visibility applied even while licensed</item>
    /// <item>maintenance — status Maintenance, unless the row is already locked</item>
    /// <item>permission — applied LAST, as an omit-gate over every state above</item>
    /// </list>
    /// <para>
    /// Step 6 being an omit-gate rather than a state of its own is the subtle one. Read naively,
    /// "permission last" would render an unlicensed module as a locked upsell row to a user with no
    /// permission on it — publishing the product catalogue to everyone with a login. Applying it as a
    /// final filter keeps the stated ordering while ensuring a locked row only ever reaches someone
    /// who could actually use the module if it were licensed, which is the only audience an upsell
    /// means anything to.
    /// </para>
    /// </summary>
    public static IReadOnlyList<NavSectionDto> Build(
        NavigationCatalogSnapshot catalog,
        IReadOnlyDictionary<string, EntitlementEntry> entitlements,
        IReadOnlySet<string> permissions,
        bool isAdministrator,
        DateTimeOffset now)
    {
        var itemsBySection = HostNavigationCatalog.Sections
            .ToDictionary(s => s.Key, _ => new List<NavNodeDto>(), StringComparer.Ordinal);

        foreach (var entry in HostNavigationCatalog.Entries.OrderBy(e => e.Order))
        {
            var node = BuildHostNode(entry, entitlements, permissions, isAdministrator, now);
            if (node is not null && itemsBySection.TryGetValue(entry.SectionKey, out var bucket))
            {
                bucket.Add(node);
            }
        }

        foreach (var app in catalog.Features
                     .Where(f => f.ParentKey is null && f.Key.StartsWith(RemotePrefix, StringComparison.Ordinal))
                     .OrderBy(f => f.SortOrder).ThenBy(f => f.DisplayName, StringComparer.Ordinal))
        {
            var node = BuildAppNode(app, catalog, entitlements, permissions, isAdministrator, now);
            if (node is not null)
            {
                itemsBySection[HostNavigationCatalog.AppsSectionKey].Add(node);
            }
        }

        return HostNavigationCatalog.Sections
            .Select(s => new NavSectionDto(s.Key, s.Label, s.Order, itemsBySection[s.Key]))
            // An empty section is dropped rather than rendered as a bare heading with nothing under it.
            .Where(s => s.Items.Count > 0)
            .ToList();
    }

    private static NavNodeDto? BuildHostNode(
        HostNavigationCatalog.Entry entry,
        IReadOnlyDictionary<string, EntitlementEntry> entitlements,
        IReadOnlySet<string> permissions,
        bool isAdministrator,
        DateTimeOffset now)
    {
        var (state, lockReason) = EvaluateEntitlement(entry.RequiredFeatureKey, entitlements, now);
        if (state is null) return null;

        if (!isAdministrator && !HasPermission(entry.RequiredFeatureKey, entry.RequiredCapability, permissions))
        {
            return null;
        }

        return new NavNodeDto(
            entry.Key, entry.Label, entry.IconKey, entry.RoutePath,
            Page: null, entry.Order, Kind: "host",
            state, lockReason, MaintenanceMessage: null, Remote: null, Children: []);
    }

    private static NavNodeDto? BuildAppNode(
        NavFeature app,
        NavigationCatalogSnapshot catalog,
        IReadOnlyDictionary<string, EntitlementEntry> entitlements,
        IReadOnlySet<string> permissions,
        bool isAdministrator,
        DateTimeOffset now)
    {
        // Gate 1. A remote app with no replicated render metadata cannot be mounted, so it is not
        // navigation yet — it is a half-finished sync.
        if (!app.IsActive) return null;
        if (!catalog.RenderByFeatureKey.TryGetValue(app.Key, out var render)) return null;

        // Gate 2.
        if (string.Equals(render.Status, "Disabled", StringComparison.OrdinalIgnoreCase)) return null;

        // Gates 3 and 4.
        var (state, lockReason) = EvaluateEntitlement(app.Key, entitlements, now);
        if (state is null) return null;

        // Gate 5. Maintenance never overrides locked: an unlicensed module that also happens to be
        // under maintenance is, first and foremost, unlicensed.
        string? maintenanceMessage = null;
        if (state == StateVisible && string.Equals(render.Status, "Maintenance", StringComparison.OrdinalIgnoreCase))
        {
            state = StateMaintenance;
            maintenanceMessage = render.MaintenanceMessage;
        }

        var appKey = app.Key[RemotePrefix.Length..];
        var children = new List<NavNodeDto>();

        foreach (var module in catalog.Features
                     .Where(f => f.ParentKey == app.Key && f.IsActive)
                     .OrderBy(f => f.SortOrder).ThenBy(f => f.DisplayName, StringComparer.Ordinal))
        {
            if (!catalog.NavItemsByFeatureKey.TryGetValue(module.Key, out var rows)) continue;

            // A module can be licensed separately from the app containing it, so it is evaluated in
            // its own right rather than simply inheriting.
            var (moduleState, moduleLock) = EvaluateEntitlement(module.Key, entitlements, now);
            if (moduleState is null) continue;

            // Children take the more restrictive of their own state and their parent's: a locked app
            // cannot contain a usable page.
            var effectiveState = state == StateVisible ? moduleState : state;
            var effectiveLock = state == StateVisible ? moduleLock : lockReason;

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
                    effectiveState,
                    effectiveLock,
                    effectiveState == StateMaintenance ? maintenanceMessage : null,
                    Remote: null,
                    Children: []));
            }
        }

        // Gate 6 for the app row itself. It survives if the caller holds a capability on the app
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
            lockReason,
            maintenanceMessage,
            // DefaultRoutePath is the first surviving child, so /apps/lead never lands on a blank
            // frame when the remote's own first page is one the caller cannot see.
            new RemoteMountDto(appKey, render.ManifestUrl, render.ContainerName, children.FirstOrDefault()?.RoutePath),
            children);
    }

    /// <summary>Gates 3 and 4. Returns null for State when the node must be omitted entirely.</summary>
    private static (string? State, string? LockReason) EvaluateEntitlement(
        string? featureKey,
        IReadOnlyDictionary<string, EntitlementEntry> entitlements,
        DateTimeOffset now)
    {
        if (featureKey is null) return (StateVisible, null);

        var entry = EntitlementResolver.Resolve(featureKey, entitlements, now);
        return EntitlementResolver.Outcome(entry) switch
        {
            EntitlementOutcome.Hidden => (null, null),
            EntitlementOutcome.Locked => (StateLocked, entry.LockReason),
            _ => (StateVisible, null),
        };
    }

    /// <summary>
    /// Gate 6. A null capability means "any capability on this feature", which is the right default
    /// for a module whose single page is its whole surface.
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
