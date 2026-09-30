using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProductMarketplace.Api.Infrastructure.Security;
using ProductMarketplace.Application.Interfaces;

namespace ProductMarketplace.Api.Controllers;

/// <summary>
/// The catalogue as Lead Management reads it. Guarded by its own internal key (<c>Internal:CatalogApiKey</c>,
/// separate from the one that lets AuthService replay approvals), never by a user token: the
/// caller is LeadService acting for a lead user, who holds lead capabilities and nothing in this service.
/// Everything returned is limited to what the catalogue currently shows.
/// </summary>
[ApiController]
[Route("internal/catalog")]
[AllowAnonymous]
[TypeFilter(typeof(InternalCatalogKeyFilter))]
public class InternalCatalogController(ICatalogLookupService catalog) : ControllerBase
{
    [HttpGet("categories")]
    public async Task<IActionResult> Categories(CancellationToken ct) => Ok(await catalog.GetCategoriesAsync(ct));

    [HttpGet("sub-categories")]
    public async Task<IActionResult> SubCategories(CancellationToken ct) => Ok(await catalog.GetSubCategoriesAsync(ct));

    [HttpGet("categories/{categoryId:guid}/products")]
    public async Task<IActionResult> Products(Guid categoryId, CancellationToken ct) => Ok(await catalog.GetProductsAsync(categoryId, ct));

    [HttpGet("products/{productId:guid}")]
    public async Task<IActionResult> Product(Guid productId, CancellationToken ct)
    {
        var product = await catalog.GetProductAsync(productId, ct);
        return product is null ? NotFound() : Ok(product);
    }
}
