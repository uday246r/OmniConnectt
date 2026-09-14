using Microsoft.AspNetCore.Mvc;
using ProductMarketplace.Application.Interfaces;

namespace ProductMarketplace.Api.Controllers;

[ApiController]
[Route("api/dashboard")]
public class DashboardController : ControllerBase
{
    private readonly IDashboardService _service;
    public DashboardController(IDashboardService service) => _service = service;

    [HttpGet("summary")]
    public async Task<IActionResult> Summary(CancellationToken ct) => Ok(await _service.GetSummaryAsync(ct));

    [HttpGet("application-trends")]
    public async Task<IActionResult> ApplicationTrends([FromQuery] int days, CancellationToken ct)
        => Ok(await _service.GetApplicationTrendAsync(days <= 0 ? 7 : days, ct));

    [HttpGet("applications-by-category")]
    public async Task<IActionResult> ApplicationsByCategory(CancellationToken ct)
        => Ok(await _service.GetApplicationsByCategoryAsync(ct));

    [HttpGet("product-status-distribution")]
    public async Task<IActionResult> ProductStatusDistribution(CancellationToken ct)
        => Ok(await _service.GetProductStatusDistributionAsync(ct));

    [HttpGet("top-products")]
    public async Task<IActionResult> TopProducts([FromQuery] int take, CancellationToken ct)
        => Ok(await _service.GetTopProductsAsync(take <= 0 ? 5 : take, ct));

    [HttpGet("recent-products")]
    public async Task<IActionResult> RecentProducts([FromQuery] int take, CancellationToken ct)
        => Ok(await _service.GetRecentProductsAsync(take <= 0 ? 5 : take, ct));

    [HttpGet("top-searches")]
    public async Task<IActionResult> TopSearches([FromQuery] int take, CancellationToken ct)
    {
        var result = await _service.GetTopSearchesAsync(take <= 0 ? 5 : take, ct);
        return Ok(result.Select(kv => new { term = kv.Key, count = kv.Value }));
    }
}
