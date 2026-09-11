using StackExchange.Redis;

namespace AuthService.Infrastructure.Locking;

/// <summary>
/// Multi-instance implementation. Registered instead of <see cref="InProcessLock"/> when a Redis
/// connection string is configured.
/// </summary>
/// <remarks>
/// The classic <c>SET key value NX PX ttl</c> lock. What matters is the RELEASE: it is a
/// compare-and-delete, not a plain delete. A holder whose TTL lapsed mid-work no longer owns the
/// lock, and a plain <c>DEL</c> from that holder would delete whichever successor had since taken it
/// — handing the lock to a third caller while the second was still working. Checking the token first
/// means a lapsed holder deletes nothing.
/// </remarks>
public sealed class RedisDistributedLock(
    IConnectionMultiplexer multiplexer,
    ILogger<RedisDistributedLock> logger) : IDistributedLock
{
    /// <summary>
    /// Compare-and-delete, as one Lua script so the comparison and the deletion cannot be interleaved
    /// with another client's acquisition.
    /// </summary>
    private const string ReleaseScript = """
        if redis.call('GET', KEYS[1]) == ARGV[1] then
            return redis.call('DEL', KEYS[1])
        else
            return 0
        end
        """;

    public async Task<IAsyncDisposable?> TryAcquireAsync(string key, TimeSpan ttl, CancellationToken ct = default)
    {
        var token = Guid.NewGuid().ToString("N");

        try
        {
            var db = multiplexer.GetDatabase();
            var acquired = await db.StringSetAsync(key, token, ttl, When.NotExists);

            return acquired ? new Release(db, key, token, logger) : null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Fail CLOSED. Answering "you may proceed" when the lock cannot be checked would let every
            // replica run the work at once, which is the exact thing this exists to prevent — and the
            // work in question (a health sweep) is safe to skip and retry on the next tick.
            logger.LogWarning(ex, "Could not reach Redis to take the '{Key}' lock; skipping this turn.", key);
            return null;
        }
    }

    private sealed class Release(IDatabase db, string key, string token, ILogger logger) : IAsyncDisposable
    {
        private int released;

        public async ValueTask DisposeAsync()
        {
            if (Interlocked.Exchange(ref released, 1) != 0)
            {
                return;
            }

            try
            {
                await db.ScriptEvaluateAsync(ReleaseScript, [key], [token]);
            }
            catch (Exception ex)
            {
                // Not fatal: the TTL releases it anyway. The next sweep is simply delayed.
                logger.LogWarning(ex, "Could not release the '{Key}' lock; it will lapse on its TTL.", key);
            }
        }
    }
}
