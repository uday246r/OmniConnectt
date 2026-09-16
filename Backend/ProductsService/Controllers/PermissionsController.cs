using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProductMarketplace.Api.Infrastructure.Security;

namespace ProductMarketplace.Api.Controllers;

/// <summary>
/// Capability and navigation discovery. AuthService reads this when the app is registered or resynced,
/// to build the Role editor's permission list and the host sidebar.
/// </summary>
/// <remarks>
/// The capability set is reflected from the authorization attributes on this service's controllers — the
/// same model LeadService uses — so what is published is exactly what is enforced. The manifests supply
/// wording, icons and ordering, plus capabilities enforced outside the token (exports).
/// </remarks>
[ApiController]
[Route("permissions")]
[AllowAnonymous]
public class PermissionsController(ILogger<PermissionsController> logger) : ControllerBase
{
    public sealed record DiscoveredCapability(string Key, string DisplayName, string? Description, string Type);

    public sealed record DiscoveredNavItem(string Key, string Label, string IconKey, string RouteSegment, int SortOrder, string? RequiredCapability);

    public sealed record DiscoveredModule(string Key, string DisplayName, int SortOrder, IReadOnlyList<DiscoveredCapability> Capabilities, IReadOnlyList<DiscoveredNavItem> Nav);

    [HttpGet]
    public ActionResult<object> Get()
    {
        var modules = Discover();

        foreach (var nav in ProductsNavigationManifest.Modules.Where(n => modules.All(m => m.Key != n.ModuleKey)))
        {
            logger.LogWarning("Navigation for module '{Module}' is declared but no endpoint requires any capability in it; its sidebar row is not published.", nav.ModuleKey);
        }

        return Ok(new
        {
            modules,
            capabilities = modules
                .SelectMany(m => m.Capabilities.Where(c => c.Type == "Api")
                    .Select(c => new { key = $"{m.Key}.{c.Key}", displayName = $"{m.DisplayName} — {c.DisplayName}" }))
                .ToList(),
        });
    }

    /// <summary>Every module:Capability demanded anywhere in this assembly.</summary>
    public static IReadOnlyList<(string Module, string Capability)> ReflectEnforced()
    {
        var found = new HashSet<(string, string)>();
        foreach (var type in typeof(PermissionsController).Assembly.GetTypes().Where(t => typeof(ControllerBase).IsAssignableFrom(t)))
        {
            var members = new MemberInfo[] { type }
                .Concat(type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly));

            foreach (var member in members)
            {
                foreach (var a in member.GetCustomAttributes<RequiresCapabilityAttribute>(true))
                    found.Add((a.Module.ToLowerInvariant(), a.Capability));
                foreach (var a in member.GetCustomAttributes<RequiresAnyCapabilityAttribute>(true))
                    foreach (var (module, capability) in a.Alternatives)
                        found.Add((module.ToLowerInvariant(), capability));
            }
        }

        return found.ToList();
    }

    public static List<DiscoveredModule> Discover()
    {
        var enforced = ReflectEnforced();

        return enforced
            .GroupBy(e => e.Module)
            .Select(group =>
            {
                var manifest = ProductsCapabilityManifest.For(group.Key);
                var nav = ProductsNavigationManifest.Find(group.Key);

                var reflected = group
                    .Select(e =>
                    {
                        var described = manifest.FirstOrDefault(c => string.Equals(c.Key, e.Capability, StringComparison.OrdinalIgnoreCase));
                        return (Sort: described?.SortOrder ?? 999,
                            Capability: new DiscoveredCapability(e.Capability, described?.DisplayName ?? e.Capability, described?.Description, "Api"));
                    });

                // Capabilities enforced outside the token (exports and similar) come only from the manifest.
                var extras = manifest
                    .Where(c => c.Type != "Api" && group.All(e => !string.Equals(e.Capability, c.Key, StringComparison.OrdinalIgnoreCase)))
                    .Select(c => (Sort: c.SortOrder, Capability: new DiscoveredCapability(c.Key, c.DisplayName, c.Description, c.Type)));

                return new DiscoveredModule(
                    group.Key,
                    nav?.DisplayName ?? group.Key,
                    nav?.SortOrder ?? 999,
                    reflected.Concat(extras).OrderBy(x => x.Sort).Select(x => x.Capability).ToList(),
                    nav is null
                        ? []
                        : nav.Nav.Select(n => new DiscoveredNavItem(n.Key, n.Label, n.IconKey, n.Key, n.SortOrder, n.RequiredCapability)).ToList());
            })
            .OrderBy(m => m.SortOrder)
            .ThenBy(m => m.Key, StringComparer.Ordinal)
            .ToList();
    }
}
