using AuthService.Application.DTOs;

namespace AuthService.Application.Remotes;

/// <summary>
/// Groups the flat capability and navigation rows a remote declared back into the nested
/// feature/module shape the permission catalog stores.
/// </summary>
/// <remarks>
/// Pure and static — no database, no HTTP, no clock. It was previously a private method on the
/// registry's outbound HTTP client, where the only way to exercise it was to stand up a fake server
/// and read the JSON it posted. The grouping is the part with the interesting edge cases (the
/// null-versus-empty navigation rule especially), so it belongs somewhere a test can call directly.
/// </remarks>
public static class RemoteFeatureRequestBuilder
{
    /// <param name="capabilities">
    /// Null when the remote could not be read. Passed straight through, because null is what tells
    /// the catalog to leave the stored set alone rather than deactivate it.
    /// </param>
    /// <param name="nav">
    /// Null when the remote reported no navigation at all — a v1 remote, or an unreachable one — so
    /// the stored sidebar rows are kept. An empty list for a module the remote DID describe is a real
    /// answer: that module is grantable but contributes no row.
    /// </param>
    public static UpsertPermissionFeatureRequest Build(
        string featureKey,
        string displayName,
        int sortOrder,
        IReadOnlyList<RemoteCapability>? capabilities,
        IReadOnlyList<RemoteNavItem>? nav = null)
    {
        if (capabilities is null)
        {
            // Nothing was discovered, so nothing is asserted: both halves stay null and the catalog
            // leaves this feature's capabilities and sub-modules exactly as they are.
            return new UpsertPermissionFeatureRequest(featureKey, displayName, sortOrder, null, null);
        }

        // Capabilities with no module hang directly off the feature; the rest become child features.
        var rootCapabilities = capabilities
            .Where(c => string.IsNullOrEmpty(c.ModuleKey))
            .Select((c, i) => new UpsertCapabilityRequest(c.Key, c.DisplayName, i * 10, c.Description, c.Type))
            .ToList();

        // Grouped once rather than per module, so the whole projection stays O(n).
        var navByModule = nav?
            .GroupBy(n => n.ModuleKey, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);

        var modules = capabilities
            .Where(c => !string.IsNullOrEmpty(c.ModuleKey))
            .GroupBy(c => (c.ModuleKey, c.ModuleDisplayName))
            .Select((g, moduleIndex) => new UpsertModuleRequest(
                g.Key.ModuleKey,
                g.Key.ModuleDisplayName,
                moduleIndex * 10,
                g.Select((c, i) => new UpsertCapabilityRequest(c.Key, c.DisplayName, i * 10, c.Description, c.Type)).ToList(),
                navByModule is null
                    ? null
                    : (navByModule.TryGetValue(g.Key.ModuleKey, out var rows) ? rows : [])
                        .OrderBy(n => n.SortOrder)
                        .Select(n => new UpsertNavItemRequest(
                            n.Key, n.Label, n.IconKey, n.RouteSegment, n.SortOrder, n.RequiredCapability))
                        .ToList()))
            .ToList();

        return new UpsertPermissionFeatureRequest(featureKey, displayName, sortOrder, rootCapabilities, modules);
    }
}
