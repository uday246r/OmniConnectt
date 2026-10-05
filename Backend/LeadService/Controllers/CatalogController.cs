using LeadManagement.Api.Infrastructure;
using LeadManagement.Api.Infrastructure.Security;
using LeadManagement.Api.Models.Dtos;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LeadManagement.Api.Controllers
{
    /// <summary>
    /// The product catalogue as the lead form and Field Settings see it: Category → Product, read from the
    /// Marketplace by <see cref="ProductCatalogClient"/>. Lead Management owns no product data — what
    /// appears here is exactly what the Marketplace currently offers, so a category switched off there
    /// vanishes from the lead form on its own.
    /// </summary>
    /// <remarks>
    /// Served by this service rather than called by the browser directly, because a lead user holds lead
    /// permissions and none in the Marketplace, and so that the browser needs one base URL and one token.
    /// </remarks>
    [ApiController]
    [Route("api/catalog")]
    // [Authorize]: the [RequiresAnyCapability] filter is hand-written and does not honour AllowAnonymous.
    [Authorize]
    public class CatalogController(ProductCatalogClient catalog) : ControllerBase
    {
        private const string LeadOrFieldSettings = "FieldSettings:View";

        /// <summary>Categories that have at least one product a lead can be taken for.</summary>
        [HttpGet("categories")]
        [RequiresAnyCapability(LeadOrFieldSettings, "Lead:View", "Lead:Create", "Lead:Edit")]
        public async Task<ActionResult<ApiResponseDto<IReadOnlyList<CatalogCategory>>>> Categories(CancellationToken ct) =>
            Ok(new ApiResponseDto<IReadOnlyList<CatalogCategory>> { Success = true, Data = await catalog.GetCategoriesAsync(ct) });

        [HttpGet("categories/{categoryId:guid}/products")]
        [RequiresAnyCapability(LeadOrFieldSettings, "Lead:View", "Lead:Create", "Lead:Edit")]
        public async Task<ActionResult<ApiResponseDto<IReadOnlyList<CatalogProduct>>>> Products(Guid categoryId, CancellationToken ct) =>
            Ok(new ApiResponseDto<IReadOnlyList<CatalogProduct>> { Success = true, Data = await catalog.GetProductsAsync(categoryId, ct) });

        /// <summary>
        /// The sub-categories Field Settings is organised by (one lead form per sub-category), and the
        /// filter lists on the lead screens.
        /// </summary>
        [HttpGet("sub-categories")]
        [RequiresAnyCapability(LeadOrFieldSettings, "Lead:View", "Lead:Create", "Lead:Edit")]
        public async Task<ActionResult<ApiResponseDto<IReadOnlyList<CatalogSubCategory>>>> SubCategories(CancellationToken ct) =>
            Ok(new ApiResponseDto<IReadOnlyList<CatalogSubCategory>> { Success = true, Data = await catalog.GetSubCategoriesAsync(ct) });
    }
}
