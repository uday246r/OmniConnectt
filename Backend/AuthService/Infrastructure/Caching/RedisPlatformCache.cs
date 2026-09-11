using System.Text.Json;
using Microsoft.Extensions.Caching.Distributed;
using StackExchange.Redis;

namespace AuthService.Infrastructure.Caching;

/// <summary>
/// Multi-instance implementation. Registered instead of <see cref="MemoryPlatformCache"/> when a
/// Redis connection string is configured.
/// </summary>
/// <remarks>
/// <para>
/// This is what makes running more than one replica correct rather than merely possible. With the
/// in-memory cache, a role edit on instance A evicted A's navigation catalog and left B serving the
/// old sidebar until its own TTL happened to lapse — so which answer a user got depended on which
/// replica the load balancer picked, and refreshing could flip between them.
/// </para>
/// <para>
/// Values are stored as JSON, which is why the keys that hold record graphs carry an explicit shape
/// version (see <see cref="Application.Services.NavigationAppService.CatalogCacheKey"/>): a deploy
/// that changes the record would otherwise deserialize a payload written by the previous version into
/// the new shape and serve something subtly wrong.
/// </para>
/// <para>
/// A Redis outage degrades rather than breaks. Every read answers null (a miss, so the caller
/// rebuilds from the database) and every write is dropped, both logged. That is slower, not wrong —
/// unlike letting the exception escape, which would take down endpoints that only wanted a cache.
/// </para>
/// </remarks>
public sealed class RedisPlatformCache(
    IDistributedCache cache,
    IConnectionMultiplexer multiplexer,
    ILogger<RedisPlatformCache> logger) : IPlatformCache
{
    private static readonly JsonSerializerOptions SerializerOptions = new(JsonSerializerDefaults.Web);

    public async Task<T?> GetAsync<T>(string key, CancellationToken ct = default) where T : class
    {
        try
        {
            var payload = await cache.GetStringAsync(key, ct);
            return payload is null ? null : JsonSerializer.Deserialize<T>(payload, SerializerOptions);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // A miss, deliberately: the caller rebuilds from the database and carries on.
            logger.LogWarning(ex, "Redis read failed for {Key}; treating as a cache miss.", key);
            return null;
        }
    }

    public async Task SetAsync<T>(string key, T value, TimeSpan ttl, CancellationToken ct = default) where T : class
    {
        try
        {
            await cache.SetStringAsync(
                key,
                JsonSerializer.Serialize(value, SerializerOptions),
                new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = ttl },
                ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Redis write failed for {Key}; the value is simply not cached.", key);
        }
    }

    public async Task RemoveAsync(string key, CancellationToken ct = default)
    {
        try
        {
            await cache.RemoveAsync(key, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Worth a louder log than the others: a failed eviction means a stale entry keeps being
            // served until its TTL lapses, which is a correctness problem rather than a slow path.
            logger.LogError(ex, "Redis eviction failed for {Key}; it will be served stale until it expires.", key);
        }
    }

    public async Task<long> BumpVersionAsync(string key, CancellationToken ct = default)
    {
        try
        {
            // INCR is atomic across every replica — the whole reason this is not Get-then-Set.
            return await multiplexer.GetDatabase().StringIncrementAsync(key);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "Redis version bump failed for {Key}; cached sets were NOT retired.", key);
            return 0;
        }
    }

    public async Task<long> GetVersionAsync(string key, CancellationToken ct = default)
    {
        try
        {
            var value = await multiplexer.GetDatabase().StringGetAsync(key);
            return value.TryParse(out long version) ? version : 0;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Redis version read failed for {Key}; falling back to 0.", key);
            return 0;
        }
    }
}
