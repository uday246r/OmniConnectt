using System.Reflection;
using backend.Infrastructure.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers;

/// <summary>
/// Dynamic permissions and navigation discovery for Customer360Service.
/// ModuleRegistry fetches this during app registration / resync to populate AuthService's
/// PermissionFeatures catalog, and now also the navigation rows the host sidebar renders.
/// </summary>
/// <remarks>
/// The response is additive across three generations and every one of them must keep working:
///   v1 — a flat `capabilities` array only.
///   v2 — `modules[]` with capabilities, no `nav`.
///   v3 — `modules[]` each carrying `nav[]`.
///   v4 — capabilities carry `description` and `type`, and the manifest contributes ones no endpoint
///        guards (this one). `type` defaults to "Api" when absent, which is what every earlier
///        generation meant.
/// ModuleRegistry synthesises a nav row per module when `nav` is absent, so an un-upgraded remote
/// still gets a correct sidebar, just with default icons.
/// </remarks>
[ApiController]
[Route("permissions")]
[AllowAnonymous]
public class PermissionsController(ILogger<PermissionsController> logger) : ControllerBase
{
    [HttpGet]
    public ActionResult<object> Get()
    {
        var modules = DiscoverModules();

        foreach (var module in modules.Where(m => Customer360NavigationManifest.Find(m.Key) is null))
        {
            // Not fatal — ModuleRegistry will synthesise a row — but it means a page appears in the
            // sidebar with a raw module key for a label and a default icon, which is always a
            // mistake rather than a decision.
            logger.LogWarning(
                "Module '{ModuleKey}' has [RequiresCapability] attributes but no Customer360NavigationManifest entry; " +
                "its sidebar row will be synthesised with a default label and icon.",
                module.Key);
        }

        foreach (var module in Customer360CapabilityManifest.Modules
                     .Where(m => modules.All(d => !string.Equals(d.Key, m.ModuleKey, StringComparison.OrdinalIgnoreCase))))
        {
            // A capability manifest entry for a module reflection never saw has nowhere to attach, so
            // it is silently dropped. That is a typo in the manifest, not a configuration.
            logger.LogWarning(
                "Customer360CapabilityManifest declares capabilities for module '{ModuleKey}', which has no [RequiresCapability] attributes; they will not be published.",
                module.ModuleKey);
        }

        return Ok(new
        {
            modules,

            // The v1 flat array stays exactly what it has always meant: the endpoint-enforced set.
            // A registry old enough to read this field instead of `modules` cannot carry a capability
            // type, so anything listed here is taken as API-enforced and put in the JWT — which is
            // right for these and would be wrong for a UI panel. Class B capabilities are reachable
            // only through `modules`, where their type travels with them.
            capabilities = modules
                .SelectMany(m => m.Capabilities
                    .Where(c => c.Type == "Api")
                    .Select(c => new { key = $"{m.Key}.{c.Key}", displayName = $"{m.DisplayName} — {c.DisplayName}" }))
                .ToList(),
        });
    }

    /// <param name="Type">
    /// "Api" for anything reflection found, because those are enforced by a filter reading the JWT
    /// claim. Anything else comes from the capability manifest and is delivered out of band.
    /// </param>
    private record DiscoveredCapability(
        string Key,
        string DisplayName,
        string? Description = null,
        string Type = "Api");

    private record DiscoveredNavItem(string Key, string Label, string IconKey, string RouteSegment, int SortOrder, string? RequiredCapability);

    private record DiscoveredModule(
        string Key,
        string DisplayName,
        int SortOrder,
        IReadOnlyList<DiscoveredCapability> Capabilities,
        IReadOnlyList<DiscoveredNavItem> Nav);

    /// <summary>
    /// Reflects over every [RequiresCapability] in this assembly for the authoritative capability
    /// set, then left-joins the manifest for everything reflection cannot know: label, icon, route
    /// segment and ordering.
    /// </summary>
    private static List<DiscoveredModule> DiscoverModules()
    {
        var modules = new SortedDictionary<string, (string DisplayName, SortedSet<string> Capabilities)>(StringComparer.Ordinal);

        foreach (var type in typeof(PermissionsController).Assembly.GetTypes())
        {
            if (!typeof(ControllerBase).IsAssignableFrom(type))
            {
                continue;
            }

            var attributes = type.GetCustomAttributes<RequiresCapabilityAttribute>(true)
                .Concat(type
                    .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                    .SelectMany(m => m.GetCustomAttributes<RequiresCapabilityAttribute>(true)));

            foreach (var attribute in attributes)
            {
                var moduleKey = attribute.Module.ToLowerInvariant();
                if (!modules.TryGetValue(moduleKey, out var entry))
                {
                    entry = (attribute.Module, new SortedSet<string>(StringComparer.Ordinal));
                    modules[moduleKey] = entry;
                }

                entry.Capabilities.Add(attribute.Capability);
            }
        }

        return modules
            .Select(kv =>
            {
                var manifest = Customer360NavigationManifest.Find(kv.Key);
                return new DiscoveredModule(
                    kv.Key,
                    // The manifest's label wins when present — reflection can only offer the raw
                    // module string, which is what made the Role editor read "FieldSettings".
                    manifest?.DisplayName ?? kv.Value.DisplayName,
                    manifest?.SortOrder ?? 0,
                    MergeCapabilities(kv.Key, kv.Value.Capabilities),
                    manifest is null
                        ? []
                        : manifest.Nav
                            .Select(n => new DiscoveredNavItem(n.Key, n.Label, n.IconKey, n.Key, n.SortOrder, n.RequiredCapability))
                            .ToList());
            })
            .OrderBy(m => m.SortOrder)
            .ThenBy(m => m.Key, StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>
    /// Reflection-discovered capabilities plus whatever the capability manifest declares for the same
    /// module, with reflection winning any collision.
    /// </summary>
    /// <remarks>
    /// Reflection has to win, and the direction is not arbitrary. A reflected capability is enforced
    /// by a filter reading the JWT claim; letting a manifest entry of the same name override its type
    /// would take it out of the token while the filter went on demanding it from there, locking
    /// everyone out of the endpoint it guards. The reverse mistake is harmless by comparison, so the
    /// tie always goes to the enforced one.
    /// </remarks>
    private static List<DiscoveredCapability> MergeCapabilities(string moduleKey, IEnumerable<string> reflected)
    {
        var merged = reflected
            .Select(c => new DiscoveredCapability(c, c))
            .ToList();

        var reflectedKeys = merged.Select(c => c.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);

        merged.AddRange(Customer360CapabilityManifest.For(moduleKey)
            .Where(c => !reflectedKeys.Contains(c.Key))
            .Select(c => new DiscoveredCapability(c.Key, c.DisplayName, c.Description, c.Type)));

        return merged;
    }
}
