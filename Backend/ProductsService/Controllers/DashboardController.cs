using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProductMarketplace.Api.Infrastructure.Security;
using ProductMarketplace.Application.Common;
using ProductMarketplace.Application.Interfaces;

namespace ProductMarketplace.Api.Controllers;

[ApiController]
[Route("api/dashboard")]
[Authorize]
[RequiresCapability("dashboard", "View")]
public class DashboardController(IDashboardService service) : ControllerBase
{
    /// <summary>Longest trend window served. A caller could previously ask for any number of days.</summary>
    public const int MaxTrendDays = 366;

    [HttpGet("summary")]
    public async Task<IActionResult> Summary(CancellationToken ct) => Ok(await service.GetSummaryAsync(ct));

    [HttpGet("application-trends")]
    public async Task<IActionResult> ApplicationTrends([FromQuery] int days, CancellationToken ct)
        => Ok(await service.GetApplicationTrendAsync(days <= 0 ? 7 : Math.Min(days, MaxTrendDays), ct));

    [HttpGet("applications-by-category")]
    public async Task<IActionResult> ApplicationsByCategory(CancellationToken ct)
        => Ok(await service.GetApplicationsByCategoryAsync(ct));

    [HttpGet("product-status-distribution")]
    public async Task<IActionResult> ProductStatusDistribution(CancellationToken ct)
        => Ok(await service.GetProductStatusDistributionAsync(ct));

    [HttpGet("top-products")]
    public async Task<IActionResult> TopProducts([FromQuery] int take, CancellationToken ct)
        => Ok(await service.GetTopProductsAsync(Paging.ClampTake(take, 5), ct));

    [HttpGet("recent-products")]
    public async Task<IActionResult> RecentProducts([FromQuery] int take, CancellationToken ct)
        => Ok(await service.GetRecentProductsAsync(Paging.ClampTake(take, 5), ct));

    [HttpGet("top-searches")]
    public async Task<IActionResult> TopSearches([FromQuery] int take, CancellationToken ct)
    {
        var result = await service.GetTopSearchesAsync(Paging.ClampTake(take, 5), ct);
        return Ok(result.Select(kv => new { term = kv.Key, count = kv.Value }));
    }
}
