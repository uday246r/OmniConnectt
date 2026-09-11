using System.Collections.Concurrent;

namespace AuthService.Infrastructure.Locking;

/// <summary>
/// Single-instance implementation. The default when no Redis connection string is configured.
/// </summary>
/// <remarks>
/// This is exactly the semaphore gate the health prober used to own privately, lifted behind the
/// interface so the prober has one code path whether or not a backplane exists. With one process
/// there is nothing to coordinate with, so the TTL is irrelevant here and deliberately ignored —
/// disposal is the only release, and a crashed process releases everything by exiting.
/// </remarks>
public sealed class InProcessLock : IDistributedLock
{
    private readonly ConcurrentDictionary<string, SemaphoreSlim> gates = new(StringComparer.Ordinal);

    public Task<IAsyncDisposable?> TryAcquireAsync(string key, TimeSpan ttl, CancellationToken ct = default)
    {
        var gate = gates.GetOrAdd(key, static _ => new SemaphoreSlim(1, 1));

        // Zero timeout, not a wait: a caller who cannot have the lock right now is told so, rather
        // than piling up behind whoever holds it.
        return Task.FromResult<IAsyncDisposable?>(gate.Wait(0) ? new Release(gate) : null);
    }

    private sealed class Release(SemaphoreSlim gate) : IAsyncDisposable
    {
        private int released;

        public ValueTask DisposeAsync()
        {
            // Guarded: releasing a SemaphoreSlim twice raises its count above its maximum and lets two
            // callers hold a lock that is supposed to admit one.
            if (Interlocked.Exchange(ref released, 1) == 0)
            {
                gate.Release();
            }

            return ValueTask.CompletedTask;
        }
    }
}
