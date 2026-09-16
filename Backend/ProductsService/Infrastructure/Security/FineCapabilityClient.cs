using System.Net.Http.Json;
using ProductMarketplace.Api.Options;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace ProductMarketplace.Api.Infrastructure.Security;

/// <summary>
/// Asks AuthService which fine-grained capabilities a user holds, and remembers the answer briefly.
/// </summary>
/// <remarks>
/// <para>
/// API capabilities arrive in the JWT and cost nothing to check. Fine-grained ones — KPI cards,
/// charts, exports, panels — deliberately do not, because a token carrying every one of them would
/// grow past what proxies forward once each app declares its own. That trade buys a bounded token and
/// costs this: a network call, and the need to decide what happens when it fails.
/// </para>
/// <para>
/// It fails closed. An unanswerable question about a permission is answered "no". The alternative —
/// assuming the capability while AuthService is unreachable — turns every outage into an
/// authorization bypass, and these capabilities gate exports and bulk operations, not decoration.
/// </para>
/// </remarks>
public class FineCapabilityClient(
    HttpClient httpClient,
    IOptions<AuthIntegrationOptions> options,
    IMemoryCache cache,
    ILogger<FineCapabilityClient> logger)
{
    private readonly AuthIntegrationOptions _options = options.Value;

    /// <summary>
    /// Short. AuthService evicts its own copy the moment a role or override is saved, but this service
    /// has no way to hear about that, so the only thing bounding how long a revoked capability keeps
    /// working here is this number.
    /// </summary>
    private static readonly TimeSpan CacheDuration = TimeSpan.FromSeconds(30);

    private record Response(IReadOnlyList<string> Capabilities);

    public async Task<IReadOnlyList<string>> GetForUserAsync(Guid userId, CancellationToken ct = default)
    {
        var key = $"fine-capabilities:{userId}";
        if (cache.TryGetValue(key, out IReadOnlyList<string>? cached) && cached is not null)
        {
            return cached;
        }

        if (string.IsNullOrWhiteSpace(_options.BaseUrl))
        {
            logger.LogError(
                "AuthService__BaseUrl is not configured — fine-grained capabilities cannot be resolved, so every one of them will be refused.");
            return [];
        }

        try
        {
            using var request = new HttpRequestMessage(
                HttpMethod.Get, $"{_options.BaseUrl.TrimEnd('/')}/internal/capabilities/{userId}");
            request.Headers.Add("X-Internal-Api-Key", _options.InternalApiKey);

            using var response = await httpClient.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning(
                    "AuthService answered {StatusCode} for the fine-grained capabilities of user {UserId}; refusing them for now.",
                    response.StatusCode, userId);
                return [];
            }

            var body = await response.Content.ReadFromJsonAsync<Response>(cancellationToken: ct);
            var resolved = body?.Capabilities ?? [];

            // Only a real answer is cached. Caching a failure would extend one blip into thirty
            // seconds of refusals for that user, and the retry is cheap.
            cache.Set(key, resolved, CacheDuration);
            return resolved;
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning(
                ex, "Could not reach AuthService for the fine-grained capabilities of user {UserId}; refusing them for now.", userId);
            return [];
        }
    }
}
