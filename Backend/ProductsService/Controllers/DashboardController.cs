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
    /// <summary>The window the "change" on each figure looks back over, when the caller does not say.</summary>
    public const int DefaultComparedDays = 30;

    /// <summary>The longest window served. A caller could otherwise ask for any number of days.</summary>
    public const int MaxComparedDays = 366;

    [HttpGet("summary")]
    public async Task<IActionResult> Summary([FromQuery] int days, CancellationToken ct)
        => Ok(await service.GetSummaryAsync(days <= 0 ? DefaultComparedDays : Math.Min(days, MaxComparedDays), ct));

    /// <summary>Products per category; or, with <c>categoryId</c>, per sub-category of that category.</summary>
    [HttpGet("product-breakdown")]
    public async Task<IActionResult> ProductBreakdown([FromQuery] Guid? categoryId, CancellationToken ct)
        => Ok(await service.GetProductBreakdownAsync(categoryId, ct));

    [HttpGet("product-status-distribution")]
    public async Task<IActionResult> ProductStatusDistribution(CancellationToken ct)
        => Ok(await service.GetProductStatusDistributionAsync(ct));

    [HttpGet("recent-products")]
    public async Task<IActionResult> RecentProducts([FromQuery] int take, CancellationToken ct)
        => Ok(await service.GetRecentProductsAsync(Paging.ClampTake(take, 5), ct));

    /// <summary>What people changed lately. Its own endpoint so the dashboard does not need the audit capability.</summary>
    [HttpGet("recent-activity")]
    public async Task<IActionResult> RecentActivity([FromQuery] int take, CancellationToken ct)
        => Ok(await service.GetRecentActivityAsync(Paging.ClampTake(take, 5), ct));

    [HttpGet("top-searches")]
    public async Task<IActionResult> TopSearches([FromQuery] int take, CancellationToken ct)
    {
        var result = await service.GetTopSearchesAsync(Paging.ClampTake(take, 5), ct);
        return Ok(result.Select(kv => new { term = kv.Key, count = kv.Value }));
    }
}
