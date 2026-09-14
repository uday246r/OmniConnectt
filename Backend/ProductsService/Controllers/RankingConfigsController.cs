using Microsoft.AspNetCore.Mvc;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;

namespace ProductMarketplace.Api.Controllers;

[ApiController]
[Route("api/ranking-configs")]
public class RankingConfigsController : ControllerBase
{
    private readonly IRankingConfigService _service;

    public RankingConfigsController(IRankingConfigService service)
    {
        _service = service;
    }

    [HttpGet]
    public async Task<IActionResult> GetConfig(CancellationToken ct)
    {
        var config = await _service.GetConfigAsync(ct);
        return Ok(config);
    }

    [HttpPut]
    public async Task<IActionResult> UpdateConfig([FromBody] RankingConfigUpdateDto dto, CancellationToken ct)
    {
        var updated = await _service.UpdateConfigAsync(dto, ct);
        return Ok(updated);
    }
}
