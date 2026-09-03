using System.Reflection;
using LeadManagement.Api.Infrastructure.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LeadManagement.Api.Controllers;

/// <summary>
/// Dynamic permissions and navigation discovery for LeadService.
/// ModuleRegistry fetches this during app registration / resync to populate AuthService's
/// PermissionFeatures catalog, and now also the navigation rows the host sidebar renders.
/// </summary>
/// <remarks>
/// The response is additive across three generations and every one of them must keep working:
///   v1 — a flat `capabilities` array only.
///   v2 — `modules[]` with capabilities, no `nav`.
///   v3 — `modules[]` each carrying `nav[]` (this one).
/// ModuleRegistry synthesises a nav row per module when `nav` is absent, so an un-upgraded remote
/// still gets a correct sidebar, just with default icons. `capabilities` is still emitted unchanged.
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

        foreach (var module in modules.Where(m => LeadNavigationManifest.Find(m.Key) is null))
        {
            // Not fatal — ModuleRegistry will synthesise a row — but it means a page appears in the
            // sidebar with a raw module key for a label and a default icon, which is always a
            // mistake rather than a decision.
            logger.LogWarning(
                "Module '{ModuleKey}' has [RequiresCapability] attributes but no LeadNavigationManifest entry; " +
                "its sidebar row will be synthesised with a default label and icon.",
                module.Key);
        }

        return Ok(new
        {
            modules,
            capabilities = modules
                .SelectMany(m => m.Capabilities.Select(c => new { key = $"{m.Key}.{c.Key}", displayName = $"{m.DisplayName} — {c.DisplayName}" }))
                .ToList(),
        });
    }

    private record DiscoveredCapability(string Key, string DisplayName);

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
                var manifest = LeadNavigationManifest.Find(kv.Key);
                return new DiscoveredModule(
                    kv.Key,
                    // The manifest's label wins when present — reflection can only offer the raw
                    // module string, which is what made the Role editor read "FieldSettings".
                    manifest?.DisplayName ?? kv.Value.DisplayName,
                    manifest?.SortOrder ?? 0,
                    kv.Value.Capabilities.Select(c => new DiscoveredCapability(c, c)).ToList(),
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
}
