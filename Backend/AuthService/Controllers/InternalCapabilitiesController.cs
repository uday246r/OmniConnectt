using AuthService.Application.Services;
using AuthService.Infrastructure.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AuthService.Controllers;

/// <summary>
/// Lets a remote service ask what fine-grained capabilities one user holds, so it can enforce them.
/// </summary>
/// <remarks>
/// A remote service has no access to AuthDb, and fine-grained capabilities are not in the JWT by
/// design, so this is the only way LeadService or Customer360Service can refuse a request for a KPI
/// its caller was never granted. The remote caches the answer briefly and fails closed if it cannot
/// get one — see RequiresFineCapabilityAttribute in either service.
/// <para>
/// Guarded by the shared internal API key like every other service-to-service route here. The user id
/// is a parameter rather than a claim because the caller is a service, not the person: the remote has
/// already validated that person's token and is asking on their behalf.
/// </para>
/// </remarks>
[ApiController]
[Route("internal/capabilities")]
[AllowAnonymous]
[TypeFilter(typeof(InternalApiKeyFilter))]
public class InternalCapabilitiesController(FineCapabilityService capabilities) : ControllerBase
{
    public record FineCapabilitiesResponse(IReadOnlyList<string> Capabilities);

    [HttpGet("{userId:guid}")]
    public async Task<ActionResult<FineCapabilitiesResponse>> Get(Guid userId, CancellationToken ct = default)
        => Ok(new FineCapabilitiesResponse(await capabilities.GetForUserAsync(userId, ct)));
}
