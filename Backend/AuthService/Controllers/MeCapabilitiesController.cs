using System.IdentityModel.Tokens.Jwt;
using System.Security.Cryptography;
using System.Text;
using AuthService.Application.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AuthService.Controllers;

/// <summary>
/// The caller's own fine-grained capabilities — the half of the permission model deliberately kept
/// out of the JWT.
/// </summary>
/// <remarks>
/// The host fetches this once after signing in and merges it with the permissions it already reads
/// from the token, so <c>hasCapability</c> answers from one set and neither the host nor any remote
/// has to know which delivery path a given capability took.
/// <para>
/// This endpoint is a convenience for rendering, never a security boundary. Anything that matters is
/// enforced server-side by a filter — <c>[RequiresCapability]</c> from the claim, or
/// <c>[RequiresFineCapability]</c> from this same resolver. Hiding a KPI in React is not a control.
/// </para>
/// </remarks>
[ApiController]
[Route("api/me")]
[Authorize]
public class MeCapabilitiesController(FineCapabilityService capabilities) : ControllerBase
{
    public record FineCapabilitiesResponse(IReadOnlyList<string> Capabilities);

    [HttpGet("capabilities")]
    public async Task<ActionResult<FineCapabilitiesResponse>> Get(CancellationToken ct = default)
    {
        var sub = User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
        if (!Guid.TryParse(sub, out var userId))
        {
            // [Authorize] has already established the caller is authenticated, so a token with no
            // usable subject is malformed rather than anonymous. Answering with an empty set would
            // silently render a stripped-down UI; refusing makes the failure visible.
            return Unauthorized();
        }

        var resolved = await capabilities.GetForUserAsync(userId, ct);

        // Weak, because the body is regenerated per request and only its content is being compared;
        // the response is short and the point of the tag is to skip re-sending it, not to make any
        // byte-for-byte guarantee.
        var etag = $"W/\"{Hash(resolved)}\"";

        if (Request.Headers.IfNoneMatch.Any(v => v == etag))
        {
            return StatusCode(StatusCodes.Status304NotModified);
        }

        Response.Headers.ETag = etag;

        // Private, because this is one user's permissions and a shared cache holding it would serve
        // it to the next person through the same proxy. no-cache rather than a max-age: the client
        // should revalidate every time and get a cheap 304, so a revoked capability disappears on the
        // next navigation rather than whenever a timer happens to expire.
        Response.Headers.CacheControl = "private, no-cache";

        return Ok(new FineCapabilitiesResponse(resolved));
    }

    private static string Hash(IReadOnlyList<string> capabilities)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(string.Join('\n', capabilities)));
        return Convert.ToHexString(bytes)[..16];
    }
}
