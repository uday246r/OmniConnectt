using System.Text.Json;
using backend.Controllers;
using backend.Infrastructure.Security;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Customer360Service.Tests;

/// <summary>
/// The <c>/permissions</c> payload — this service's declaration of what can be granted, and the only
/// thing AuthService knows about it.
/// </summary>
/// <remarks>
/// Everything downstream is derived from this: the permission catalog, the Role editor's checkboxes,
/// the sidebar. A mistake here does not throw anywhere — it quietly makes a capability ungrantable,
/// or grants one that no longer exists, and the first symptom is somebody noticing a missing tick box.
/// </remarks>
public class PermissionDiscoveryTests
{
    // ---------------------------------------------------------------- shape

    [Fact]
    public void Every_module_reflection_finds_is_published()
    {
        var payload = Discover();

        // Discovered from [RequiresCapability] attributes, so this is what the controllers actually
        // guard rather than a hand-maintained list that can drift from them.
        Assert.Contains("profile", payload.ModuleKeys);
        Assert.Contains("contact", payload.ModuleKeys);
        Assert.Contains("audit", payload.ModuleKeys);
        Assert.Contains("fieldsettings", payload.ModuleKeys);
    }

    [Fact]
    public void A_reflection_discovered_capability_is_typed_Api()
    {
        // Api is what puts it in the JWT for the authorization filters to read. Anything else here
        // would take an endpoint guard out of the token while the filter still demanded it from there.
        var view = Discover().Capability("contact", "View");

        Assert.Equal("Api", view.Type);
    }

    [Fact]
    public void A_manifest_capability_carries_its_declared_type_and_description()
    {
        var panel = Discover().Capability("profile", "panel.contacts");

        Assert.Equal("Ui", panel.Type);
        Assert.False(string.IsNullOrWhiteSpace(panel.Description));
    }

    [Fact]
    public void Manifest_capabilities_are_merged_onto_the_module_reflection_found()
    {
        // Both kinds live on the same module: the endpoint guard and the cards that endpoint feeds.
        var profile = Discover().Module("profile");

        Assert.Contains(profile.Capabilities, c => c.Key == "View" && c.Type == "Api");
        Assert.Contains(profile.Capabilities, c => c.Key == "panel.interactions" && c.Type == "Ui");
    }

    // ---------------------------------------------------------------- the v1 compatibility rule

    [Fact]
    public void The_flat_capabilities_array_stays_endpoint_guards_only()
    {
        /*
         * The v1 field has no place to put a type, so anything listed in it is taken as API-enforced
         * and put in the JWT. That is right for an endpoint guard and wrong for a KPI: a registry old
         * enough to read this field instead of `modules` would mint every dashboard card into the
         * token, which is precisely the growth the split exists to prevent.
         */
        var payload = Discover();

        Assert.NotEmpty(payload.FlatCapabilityKeys);
        Assert.DoesNotContain(payload.FlatCapabilityKeys, k => k.Contains('.', StringComparison.Ordinal) && k.Count(c => c == '.') > 1);
        Assert.All(payload.FlatCapabilityKeys, k =>
        {
            Assert.DoesNotContain("kpi.", k, StringComparison.Ordinal);
            Assert.DoesNotContain("chart.", k, StringComparison.Ordinal);
            Assert.DoesNotContain("export.", k, StringComparison.Ordinal);
            Assert.DoesNotContain("widget.", k, StringComparison.Ordinal);
        });
    }

    // ---------------------------------------------------------------- the manifests themselves

    [Fact]
    public void Every_capability_the_manifest_declares_has_a_description()
    {
        // The key alone rarely explains a business capability, and the description is what an
        // administrator reads in the picker before granting it.
        foreach (var module in Customer360CapabilityManifest.Modules)
        {
            Assert.All(module.Capabilities, c => Assert.False(string.IsNullOrWhiteSpace(c.Description)));
        }
    }

    [Fact]
    public void No_manifest_capability_claims_to_be_an_Api_capability()
    {
        /*
         * An Api capability is one a filter reads out of the JWT claim. Nothing in the manifest is
         * enforced that way, so declaring one as Api would put it in the token — undoing the split and
         * reintroducing exactly the unbounded growth it was built to avoid.
         */
        foreach (var module in Customer360CapabilityManifest.Modules)
        {
            Assert.All(module.Capabilities, c => Assert.NotEqual("Api", c.Type));
        }
    }

    [Fact]
    public void Every_manifest_capability_key_is_dotted_so_the_editor_can_group_it()
    {
        // The dotted prefix is the third level of the hierarchy — the reason no third table exists.
        foreach (var module in Customer360CapabilityManifest.Modules)
        {
            Assert.All(module.Capabilities, c => Assert.Contains('.', c.Key));
        }
    }

    [Fact]
    public void Capability_keys_never_contain_the_separator_itself()
    {
        // `feature:a:b` cannot be split back into a feature and a capability. Nothing emits one today;
        // this is what stops one being introduced by hand.
        foreach (var module in Customer360CapabilityManifest.Modules)
        {
            Assert.All(module.Capabilities, c => Assert.DoesNotContain(':', c.Key));
        }
    }

    [Fact]
    public void Every_capability_manifest_module_is_one_reflection_actually_finds()
    {
        // A manifest entry for a module with no [RequiresCapability] attributes has nowhere to attach
        // and is silently dropped — a typo, not a configuration.
        var discovered = Discover().ModuleKeys;

        foreach (var module in Customer360CapabilityManifest.Modules)
        {
            Assert.Contains(module.ModuleKey.ToLowerInvariant(), discovered);
        }
    }

    [Fact]
    public void Every_navigation_row_requires_a_capability_its_own_module_declares()
    {
        /*
         * A row demanding a capability the module does not declare can never be shown to anyone, and
         * nothing anywhere reports it — the page simply never appears in the sidebar for any role.
         */
        var payload = Discover();

        foreach (var module in Customer360NavigationManifest.Modules)
        {
            var declared = payload.Module(module.ModuleKey.ToLowerInvariant()).Capabilities
                .Select(c => c.Key)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            foreach (var nav in module.Nav.Where(n => n.RequiredCapability is not null))
            {
                Assert.Contains(nav.RequiredCapability!, declared);
            }
        }
    }

    [Fact]
    public void Navigation_route_segments_are_unique_across_the_app()
    {
        // Two rows sharing a segment means one of them is unreachable: the router matches the first.
        var segments = Customer360NavigationManifest.Modules
            .SelectMany(m => m.Nav)
            .Select(n => n.Key)
            .ToList();

        Assert.Equal(segments.Count, segments.Distinct(StringComparer.OrdinalIgnoreCase).Count());
    }

    // ---------------------------------------------------------------- reading the payload

    private static DiscoveryPayload Discover()
    {
        var controller = new PermissionsController(NullLogger<PermissionsController>.Instance);
        var result = Assert.IsType<OkObjectResult>(controller.Get().Result);

        // Serialised and re-read so the assertions are about the JSON that actually goes over the
        // wire, not about anonymous types that happen to be shaped conveniently.
        var json = JsonSerializer.Serialize(result.Value);
        return JsonSerializer.Deserialize<DiscoveryPayload>(
            json, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
    }

    private sealed record DiscoveryPayload(
        List<DiscoveredModule> Modules,
        List<FlatCapability> Capabilities)
    {
        public IReadOnlyList<string> ModuleKeys => Modules.Select(m => m.Key).ToList();
        public IReadOnlyList<string> FlatCapabilityKeys => Capabilities.Select(c => c.Key).ToList();

        public DiscoveredModule Module(string key) =>
            Modules.Single(m => string.Equals(m.Key, key, StringComparison.OrdinalIgnoreCase));

        public DiscoveredCapability Capability(string moduleKey, string capabilityKey) =>
            Module(moduleKey).Capabilities.Single(c => c.Key == capabilityKey);
    }

    private sealed record DiscoveredModule(string Key, string DisplayName, List<DiscoveredCapability> Capabilities);

    private sealed record DiscoveredCapability(string Key, string DisplayName, string? Description, string Type);

    private sealed record FlatCapability(string Key, string DisplayName);
}
