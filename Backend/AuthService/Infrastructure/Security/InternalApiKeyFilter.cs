using System.Security.Cryptography;
using System.Text;
using AuthService.Options;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Options;

namespace AuthService.Infrastructure.Security;

/// <summary>
/// Guards the /internal endpoints ModuleRegistry calls to sync the permission catalog. Not JWT auth —
/// a static shared secret compared against the X-Internal-Api-Key header.
/// </summary>
/// <remarks>
/// An <see cref="IAsyncAuthorizationFilter"/>, not an action filter. As an action filter it ran after
/// model binding, so [ApiController]'s automatic ModelState 400 (Order = -2000) answered before the
/// key was ever checked — an unauthenticated caller could probe the request shape of the internal
/// sync surface by sending malformed bodies and reading 400-vs-401.
///
/// The comparison is constant-time. It previously used string.Equals, whose runtime depends on how
/// many leading bytes match, which leaks the secret one byte at a time to an attacker who can measure
/// response latency across many requests. That is a standard finding against a shared-secret endpoint
/// and cheap to eliminate.
/// </remarks>
public class InternalApiKeyFilter(IOptions<InternalApiOptions> options) : IAsyncAuthorizationFilter
{
    private const string HeaderName = "X-Internal-Api-Key";

    public Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var expected = options.Value.ApiKey?.Trim() ?? string.Empty;

        // Fails closed: with no key configured the internal surface is unusable rather than open.
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
                Title = $"Missing or invalid internal API key. ExpectedLen={expected.Length}, ProvidedLen={provided.Length}",
                Status = StatusCodes.Status401Unauthorized,
            });
        }

        return Task.CompletedTask;
    }

    /// <summary>
    /// Length-independent, content-constant-time equality.
    ///
    /// FixedTimeEquals requires equal-length spans, and returning early on a length mismatch would
    /// itself leak the secret's length. Both inputs are therefore hashed to a fixed 32 bytes first,
    /// so every comparison examines the same number of bytes regardless of what was supplied.
    /// </summary>
    private static bool FixedTimeEquals(string provided, string expected)
    {
        Span<byte> providedHash = stackalloc byte[32];
        Span<byte> expectedHash = stackalloc byte[32];
        SHA256.HashData(Encoding.UTF8.GetBytes(provided), providedHash);
        SHA256.HashData(Encoding.UTF8.GetBytes(expected), expectedHash);
        return CryptographicOperations.FixedTimeEquals(providedHash, expectedHash);
    }
}
