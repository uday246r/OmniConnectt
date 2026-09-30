using System.Security.Cryptography;
using System.Text;
using ProductMarketplace.Api.Options;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Options;

namespace ProductMarketplace.Api.Infrastructure.Security;

/// <summary>
/// Guards internal/approvals/apply — the endpoint AuthService calls to replay an approved change.
/// Not JWT auth — a static shared secret compared against the X-Internal-Api-Key header. Mirrors
/// AuthService's own InternalApiKeyFilter exactly (no shared package).
/// </summary>
/// <remarks>
/// An <see cref="IAsyncAuthorizationFilter"/>, not an action filter, so it runs before [ApiController]'s
/// automatic ModelState 400 — otherwise an unauthenticated caller could probe the request shape by
/// sending malformed bodies and reading 400-vs-401.
///
/// The comparison is constant-time (hash-then-compare) rather than string.Equals, which leaks how many
/// leading bytes matched via response timing.
/// </remarks>
public class InternalApiKeyFilter(IOptions<InternalApiOptions> options) : IAsyncAuthorizationFilter
{
    private const string HeaderName = "X-Internal-Api-Key";

    public Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var expected = options.Value.ApiKey?.Trim() ?? string.Empty;

        if (string.IsNullOrWhiteSpace(expected))
        {
            context.Result = new ObjectResult(new ProblemDetails
            {
                Title = "Internal API key is not configured on this service.",
                Status = StatusCodes.Status503ServiceUnavailable,
            })
            { StatusCode = StatusCodes.Status503ServiceUnavailable };
            return Task.CompletedTask;
        }

        var provided = context.HttpContext.Request.Headers[HeaderName].ToString().Trim();
        if (!FixedTimeEquals(provided, expected))
        {
            context.Result = new UnauthorizedObjectResult(new ProblemDetails
            {
                Title = "Missing or invalid internal API key.",
                Status = StatusCodes.Status401Unauthorized,
            });
        }

        return Task.CompletedTask;
    }

    internal static bool FixedTimeEquals(string provided, string expected)
    {
        Span<byte> providedHash = stackalloc byte[32];
        Span<byte> expectedHash = stackalloc byte[32];
        SHA256.HashData(Encoding.UTF8.GetBytes(provided), providedHash);
        SHA256.HashData(Encoding.UTF8.GetBytes(expected), expectedHash);
        return CryptographicOperations.FixedTimeEquals(providedHash, expectedHash);
    }
}

/// <summary>
/// Guards internal/catalog — what Lead Management reads. The same mechanism as
/// <see cref="InternalApiKeyFilter"/> but its own secret (<c>Internal:CatalogApiKey</c>), so the key that
/// lets a service read the catalogue cannot also apply an approved change.
/// </summary>
public class InternalCatalogKeyFilter(IOptions<InternalApiOptions> options) : IAsyncAuthorizationFilter
{
    private const string HeaderName = "X-Internal-Api-Key";

    public Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var expected = options.Value.CatalogApiKey?.Trim() ?? string.Empty;

        if (string.IsNullOrWhiteSpace(expected))
        {
            context.Result = new ObjectResult(new ProblemDetails
            {
                Title = "The catalogue key is not configured on this service (Internal:CatalogApiKey).",
                Status = StatusCodes.Status503ServiceUnavailable,
            })
            { StatusCode = StatusCodes.Status503ServiceUnavailable };
            return Task.CompletedTask;
        }

        var provided = context.HttpContext.Request.Headers[HeaderName].ToString().Trim();
        if (!InternalApiKeyFilter.FixedTimeEquals(provided, expected))
        {
            context.Result = new UnauthorizedObjectResult(new ProblemDetails
            {
                Title = "Missing or invalid internal API key.",
                Status = StatusCodes.Status401Unauthorized,
            });
        }

        return Task.CompletedTask;
    }
}
