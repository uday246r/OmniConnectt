using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProductMarketplace.Api.Infrastructure.Approvals;
using ProductMarketplace.Api.Infrastructure.Security;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;

namespace ProductMarketplace.Api.Controllers;

[ApiController]
[Route("api/ranking-configs")]
[Authorize]
public class RankingConfigsController(IRankingConfigService service, ApprovalGate gate) : ControllerBase
{
    [HttpGet]
    [RequiresCapability("setup", "View")]
    public async Task<IActionResult> GetConfig(CancellationToken ct)
        => Ok(await service.GetConfigAsync(ct));

    [HttpPut]
    [RequiresCapability("setup", "Manage")]
    public async Task<IActionResult> UpdateConfig([FromBody] RankingConfigUpdateDto dto, CancellationToken ct)
    {
        var current = await service.GetConfigAsync(ct);
        var pending = await gate.TrySubmitAsync(ProductsMutations.RankingConfigUpdate, null, "Product ranking settings", dto, ct, before: current);
        if (pending is not null) return Accepted(pending);

        return Ok(await service.UpdateConfigAsync(dto, ct));
    }
}
