using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using Microsoft.Extensions.Caching.Memory;

namespace AuthService.Infrastructure.Caching;

/// <summary>
/// Single-instance implementation, over <see cref="IMemoryCache"/>. The default when no Redis
/// connection string is configured, which is how this platform runs locally.
/// </summary>
/// <remarks>
/// The version counters live in a dictionary of this class's own, NOT in the memory cache. A cache
/// entry can be evicted under memory pressure, and an evicted version counter reads back as 0 — which
/// silently resurrects every already-retired key that had not yet expired on its own, handing users
/// back capabilities an administrator had just revoked. A counter is a few bytes and must never be
/// evictable.
/// </remarks>
public sealed class MemoryPlatformCache(IMemoryCache cache) : IPlatformCache
{
    private readonly ConcurrentDictionary<string, StrongBox<long>> versions = new(StringComparer.Ordinal);

    public Task<T?> GetAsync<T>(string key, CancellationToken ct = default) where T : class =>
        Task.FromResult(cache.TryGetValue(key, out T? value) ? value : null);

    public Task SetAsync<T>(string key, T value, TimeSpan ttl, CancellationToken ct = default) where T : class
    {
        cache.Set(key, value, ttl);
        return Task.CompletedTask;
    }

    public Task RemoveAsync(string key, CancellationToken ct = default)
    {
        cache.Remove(key);
        return Task.CompletedTask;
    }

    public Task<long> BumpVersionAsync(string key, CancellationToken ct = default) =>
        Task.FromResult(Interlocked.Increment(ref Counter(key).Value));

    public Task<long> GetVersionAsync(string key, CancellationToken ct = default) =>
        Task.FromResult(Interlocked.Read(ref Counter(key).Value));

    private StrongBox<long> Counter(string key) => versions.GetOrAdd(key, static _ => new StrongBox<long>(0L));
}
