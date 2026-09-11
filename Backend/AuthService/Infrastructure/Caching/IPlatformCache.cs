namespace AuthService.Infrastructure.Caching;

/// <summary>
/// The cache the platform's shared read models live in, behind an interface so the same code runs
/// single-instance (in-memory) or multi-instance (Redis).
/// </summary>
/// <remarks>
/// <para>
/// Deliberately NOT <see cref="Microsoft.Extensions.Caching.Distributed.IDistributedCache"/> at the
/// call sites. That interface speaks <c>byte[]</c>, which pushes serialization into every consumer,
/// and it has no atomic counter — and the version counter below has to be atomic or the invalidation
/// it drives is a lie.
/// </para>
/// <para>
/// Two consumers, and they want different things. The navigation catalog is one rich object graph
/// keyed by a constant: get, set, remove. The fine-grained capability sets are per user and cannot be
/// enumerated when a role changes, so they are retired in bulk by bumping a version folded into every
/// key. Both shapes are here; nothing else needs them.
/// </para>
/// </remarks>
public interface IPlatformCache
{
    Task<T?> GetAsync<T>(string key, CancellationToken ct = default) where T : class;

    Task SetAsync<T>(string key, T value, TimeSpan ttl, CancellationToken ct = default) where T : class;

    Task RemoveAsync(string key, CancellationToken ct = default);

    /// <summary>
    /// Atomically increments a version counter and returns the new value.
    /// </summary>
    /// <remarks>
    /// Atomic because the read-modify-write it replaces (<c>Set(key, Get(key) + 1)</c>) loses races
    /// even inside one process: two concurrent invalidations both read N and both write N+1, so the
    /// second one never happens and a caller keeps being served a set that was supposed to be retired.
    /// </remarks>
    Task<long> BumpVersionAsync(string key, CancellationToken ct = default);

    /// <summary>The current version, or 0 if this counter has never been bumped.</summary>
    Task<long> GetVersionAsync(string key, CancellationToken ct = default);
}
