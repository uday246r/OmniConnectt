using AuthService.Infrastructure.Caching;
using AuthService.Infrastructure.Locking;
using Microsoft.Extensions.Caching.Memory;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// The in-memory implementations of the two primitives that let this service run on more than one
/// replica.
/// </summary>
/// <remarks>
/// Worth testing because both replace something that was previously inline and subtly wrong. The
/// version counter replaces <c>cache.Set(key, Get(key) + 1)</c>, a read-modify-write that loses
/// concurrent invalidations — and a lost invalidation means an administrator revokes a capability and
/// the affected users keep it. The lock replaces a private semaphore in the health prober, and a
/// double release there would let two sweeps run at once against the same rows.
/// <para>
/// These tests are written against the interface, so the Redis implementations can be pointed at the
/// same assertions.
/// </para>
/// </remarks>
public class PlatformCacheTests
{
    private static MemoryPlatformCache NewCache() => new(new MemoryCache(new MemoryCacheOptions()));

    private sealed record Payload(string Value);

    [Fact]
    public async Task A_value_that_was_never_written_reads_back_as_null_rather_than_throwing()
    {
        var cache = NewCache();

        var result = await cache.GetAsync<Payload>("absent");

        Assert.Null(result);
    }

    [Fact]
    public async Task A_stored_value_reads_back_unchanged()
    {
        var cache = NewCache();

        await cache.SetAsync("k", new Payload("navigation"), TimeSpan.FromMinutes(1));

        Assert.Equal(new Payload("navigation"), await cache.GetAsync<Payload>("k"));
    }

    [Fact]
    public async Task Removing_a_key_makes_the_next_read_a_miss()
    {
        var cache = NewCache();
        await cache.SetAsync("k", new Payload("v"), TimeSpan.FromMinutes(1));

        await cache.RemoveAsync("k");

        Assert.Null(await cache.GetAsync<Payload>("k"));
    }

    [Fact]
    public async Task A_value_set_with_a_lifetime_is_gone_once_it_elapses()
    {
        var cache = NewCache();

        await cache.SetAsync("k", new Payload("v"), TimeSpan.FromMilliseconds(20));
        await Task.Delay(120);

        Assert.Null(await cache.GetAsync<Payload>("k"));
    }

    [Fact]
    public async Task A_counter_that_has_never_been_bumped_reads_as_zero()
    {
        var cache = NewCache();

        Assert.Equal(0L, await cache.GetVersionAsync("v"));
    }

    [Fact]
    public async Task Bumping_a_version_is_visible_to_the_next_read()
    {
        var cache = NewCache();

        var bumped = await cache.BumpVersionAsync("v");

        Assert.Equal(1L, bumped);
        Assert.Equal(1L, await cache.GetVersionAsync("v"));
    }

    [Fact]
    public async Task Bumping_a_version_returns_a_strictly_increasing_number_under_concurrent_callers()
    {
        var cache = NewCache();
        const int callers = 200;

        var results = await Task.WhenAll(
            Enumerable.Range(0, callers).Select(_ => Task.Run(() => cache.BumpVersionAsync("v"))));

        // Every caller saw a distinct number, and the final value counts all of them. The
        // read-modify-write this replaces fails both assertions: concurrent callers read the same
        // value and write the same successor, so the counter lands well short of `callers`.
        Assert.Equal(callers, results.Distinct().Count());
        Assert.Equal(callers, await cache.GetVersionAsync("v"));
    }

    [Fact]
    public async Task Two_version_counters_do_not_share_a_number()
    {
        var cache = NewCache();

        await cache.BumpVersionAsync("a");
        await cache.BumpVersionAsync("a");
        await cache.BumpVersionAsync("b");

        Assert.Equal(2L, await cache.GetVersionAsync("a"));
        Assert.Equal(1L, await cache.GetVersionAsync("b"));
    }

    [Fact]
    public async Task Only_one_of_two_callers_holds_the_same_lock_at_once()
    {
        var locks = new InProcessLock();

        await using var first = await locks.TryAcquireAsync("sweep", TimeSpan.FromMinutes(1));
        var second = await locks.TryAcquireAsync("sweep", TimeSpan.FromMinutes(1));

        Assert.NotNull(first);
        Assert.Null(second);
    }

    [Fact]
    public async Task Releasing_a_lock_lets_the_next_caller_take_it()
    {
        var locks = new InProcessLock();

        var first = await locks.TryAcquireAsync("sweep", TimeSpan.FromMinutes(1));
        Assert.NotNull(first);
        await first.DisposeAsync();

        var second = await locks.TryAcquireAsync("sweep", TimeSpan.FromMinutes(1));

        Assert.NotNull(second);
    }

    [Fact]
    public async Task Disposing_a_lock_twice_does_not_let_two_callers_in()
    {
        var locks = new InProcessLock();

        var handle = await locks.TryAcquireAsync("sweep", TimeSpan.FromMinutes(1));
        Assert.NotNull(handle);
        await handle.DisposeAsync();
        await handle.DisposeAsync();

        // A SemaphoreSlim released twice admits two holders. The second acquire below must succeed
        // (the lock is free) and a third must not.
        await using var next = await locks.TryAcquireAsync("sweep", TimeSpan.FromMinutes(1));
        var third = await locks.TryAcquireAsync("sweep", TimeSpan.FromMinutes(1));

        Assert.NotNull(next);
        Assert.Null(third);
    }

    [Fact]
    public async Task Locks_with_different_keys_are_independent()
    {
        var locks = new InProcessLock();

        await using var sweep = await locks.TryAcquireAsync("sweep", TimeSpan.FromMinutes(1));
        await using var other = await locks.TryAcquireAsync("something-else", TimeSpan.FromMinutes(1));

        Assert.NotNull(sweep);
        Assert.NotNull(other);
    }
}
