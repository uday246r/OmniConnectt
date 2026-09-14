using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProductMarketplace.Api.Infrastructure.Security;

namespace ProductMarketplace.Api.Controllers;

/// <summary>
/// Dynamic permissions and navigation discovery for ProductsService.
/// AuthService fetches this during app registration / resync to populate AuthService's
/// PermissionFeatures catalog and sidebar navigation.
/// </summary>
[ApiController]
[Route("permissions")]
[AllowAnonymous]
public class PermissionsController : ControllerBase
{
    [HttpGet]
    public ActionResult<object> Get()
    {
        var modules = ProductsNavigationManifest.Modules.Select(m =>
        {
            var capabilities = ProductsCapabilityManifest.For(m.ModuleKey)
                .Select(c => new
                {
                    key = c.Key,
                    displayName = c.DisplayName,
                    description = c.Description,
                    type = c.Type
                })
                .ToList();

            var nav = m.Nav.Select(n => new
            {
                key = n.Key,
                label = n.Label,
                iconKey = n.IconKey,
                routeSegment = n.Key,
                sortOrder = n.SortOrder,
                requiredCapability = n.RequiredCapability
            }).ToList();

            return new
            {
                key = m.ModuleKey,
                displayName = m.DisplayName,
                sortOrder = m.SortOrder,
                capabilities,
                nav
            };
        }).ToList();

        var flatCapabilities = modules
            .SelectMany(m => m.capabilities
                .Where(c => c.type == "Api")
                .Select(c => new { key = $"{m.key}.{c.key}", displayName = $"{m.displayName} — {c.displayName}" }))
            .ToList();

        return Ok(new
        {
            modules,
            capabilities = flatCapabilities
        });
    }
}
