using System.Security.Cryptography;
using System.Text;
using AuthService.Options;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Options;

namespace AuthService.Infrastructure.Security;

/// <summary>
/// Guards the /internal endpoints the other backend services call. Not JWT auth —
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
public class InternalApiKeyFilter(IOptions<InternalApiOptions> options, ILogger<InternalApiKeyFilter> logger) : IAsyncAuthorizationFilter
{
    private const string HeaderName = "X-Internal-Api-Key";

    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var configured = options.Value;
        var legacyKey = configured.ApiKey?.Trim() ?? string.Empty;

        // Fails closed: with no key configured the internal surface is unusable rather than open.
        if (!configured.UsesPerServiceKeys && string.IsNullOrWhiteSpace(legacyKey))
        {
            context.Result = new ObjectResult(new ProblemDetails
            {
                Title = "Internal API key is not configured on this service.",
                Status = StatusCodes.Status503ServiceUnavailable,
            })
            { StatusCode = StatusCodes.Status503ServiceUnavailable };
            return;
        }

        var provided = context.HttpContext.Request.Headers[HeaderName].ToString().Trim();
        var match = Resolve(configured, legacyKey, provided);
        if (match.Accepted)
        {
            InternalCaller.Set(context.HttpContext, match.ServiceName);
            return;
        }

        {
            // Only the path goes to the log — never the supplied key, and never the expected key's
            // length, which is the exact thing FixedTimeEquals below hashes both inputs to avoid leaking.
            logger.LogDebug("Rejected an internal API call to {Path}.", context.HttpContext.Request.Path);

            context.Result = new UnauthorizedObjectResult(new ProblemDetails
            {
                Title = "Missing or invalid internal API key.",
                Status = StatusCodes.Status401Unauthorized,
            });

            /*
             * Audited, unlike the Debug log above.
             *
             * This key is the one credential that lets a caller submit an approval request as any
             * user, name any callback URL for AuthService to POST to, and write audit rows for any
             * service. A sustained run of rejections against it is the clearest sign available that
             * something is trying to reach the internal surface, and until now the only record was a
             * Debug line nobody collects.
             *
             * The row carries the path and the caller's address. It never carries the supplied key or
             * its length — the whole comparison above exists to avoid leaking exactly that.
             */
            await AuthorizationAudit.RecordDeniedAsync(
                context, "authz.internal_key_rejected", "internal:api-key",
                "The X-Internal-Api-Key header was missing or did not match");
        }
    }

    /// <summary>
    /// Finds which service a key belongs to.
    /// </summary>
    /// <remarks>
    /// Every configured key is compared, even after a match, so the time taken does not reveal how many
    /// services were checked before the right one. The legacy shared key is consulted only while no
    /// per-service key exists; after that it is refused like any other wrong key.
    /// </remarks>
    internal static (bool Accepted, string? ServiceName) Resolve(InternalApiOptions configured, string legacyKey, string provided)
    {
        if (string.IsNullOrEmpty(provided))
        {
            return (false, null);
        }

        if (configured.UsesPerServiceKeys)
        {
            string? matched = null;
            foreach (var (name, credential) in configured.Services)
            {
                var key = credential.ApiKey?.Trim() ?? string.Empty;
                if (key.Length > 0 && FixedTimeEquals(provided, key) && matched is null)
                {
                    matched = name;
                }
            }

            return (matched is not null, matched);
        }

        return (FixedTimeEquals(provided, legacyKey), null);
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
