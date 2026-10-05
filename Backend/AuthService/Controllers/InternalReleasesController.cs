using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Infrastructure.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AuthService.Controllers;

/// <summary>
/// The release pipeline's door: register a published build, promote it, roll it back, list history.
/// </summary>
/// <remarks>
/// <para>
/// Under <c>/internal</c>, which the platform's nginx never forwards — only <c>/api</c> and <c>/hubs</c>
/// reach AuthService from outside — so it is reachable solely from inside the deployment's network.
/// </para>
/// <para>
/// Holding an internal key is not enough: every backend service has one, and LeadService has no
/// business deciding which Customer 360 build users load. Only the caller whose key is configured as
/// <c>Internal:Services:ReleaseAgent</c> is accepted. In legacy single-key mode no caller can be told
/// apart, so this surface is closed entirely.
/// </para>
/// </remarks>
[ApiController]
[Route("internal/releases")]
[AllowAnonymous]
[TypeFilter(typeof(InternalApiKeyFilter))]
public class InternalReleasesController(ReleaseAppService releases) : ControllerBase
{
    public const string ReleaseAgent = "ReleaseAgent";

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<ReleaseRecordDto>>> List([FromQuery] string? key, CancellationToken ct)
        => IsReleaseAgent() ? Ok(await releases.ListAsync(key, ct)) : Refused();

    [HttpPost("register")]
    public async Task<ActionResult<ReleaseRecordDto>> Register(RegisterReleaseRequest request, CancellationToken ct)
        => IsReleaseAgent() ? Ok(await releases.RegisterAsync(request, ct)) : Refused();

    [HttpPost("promote")]
    public async Task<ActionResult<ReleaseRecordDto>> Promote(PromoteReleaseRequest request, CancellationToken ct)
        => IsReleaseAgent() ? Ok(await releases.PromoteAsync(request.Key, request.Version, ActorName(), ct)) : Refused();

    [HttpPost("rollback")]
    public async Task<ActionResult<ReleaseRecordDto>> Rollback(RollbackReleaseRequest request, CancellationToken ct)
        => IsReleaseAgent() ? Ok(await releases.RollbackAsync(request.Key, ActorName(), ct)) : Refused();

    private bool IsReleaseAgent() =>
        string.Equals(InternalCaller.Get(HttpContext), ReleaseAgent, StringComparison.Ordinal);

    /// <summary>The pipeline may name the run that acted (e.g. "github-actions #482"), for the audit row.</summary>
    private string ActorName()
    {
        var run = Request.Headers["X-Release-Actor"].ToString().Trim();
        return string.IsNullOrEmpty(run) ? "release-agent" : $"release-agent ({run[..Math.Min(run.Length, 150)]})";
    }

    private ObjectResult Refused() => StatusCode(StatusCodes.Status403Forbidden, new ProblemDetails
    {
        Title = "Only the release agent may manage releases.",
        Status = StatusCodes.Status403Forbidden,
    });
}
