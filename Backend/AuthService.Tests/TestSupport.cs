using AuthService.Application.Events;
using AuthService.Application.Services;
using AuthService.Infrastructure;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace AuthService.Tests;

/// <summary>
/// The pieces almost every service test in this project needs, in one place.
/// </summary>
/// <remarks>
/// Four separate no-op <see cref="IPlatformEventPublisher"/> implementations had grown across the
/// suite, one per file, each a slightly different copy. Beyond the duplication, none of them let a
/// test assert what was actually published — and the approval flow's correctness includes its
/// fan-out: a checker whose badge never updates has an invisible queue. <see cref="RecordingPublisher"/>
/// keeps the no-op behaviour and records, so a test can check either.
/// </remarks>
internal static class TestDb
{
    /// <summary>
    /// A fresh in-memory database, uniquely named so tests never see each other's rows.
    /// </summary>
    /// <param name="prefix">Names the database after the suite using it, which makes a leaked
    /// cross-test dependency obvious in a failure message rather than mysterious.</param>
    public static AuthDbContext Create(string prefix) => new(Options(prefix));

    /// <summary>
    /// Two contexts over ONE database — the closest this provider gets to two application instances
    /// racing the same row, and what the multi-actor approval tests are built on. Each context has
    /// its own change tracker, so "another server already committed this" is genuinely reproduced
    /// rather than simulated within one unit of work.
    /// </summary>
    public static (AuthDbContext First, AuthDbContext Second) CreatePair(string prefix)
    {
        var shared = Options($"{prefix}-{Guid.NewGuid()}", unique: false);
        return (new AuthDbContext(shared), new AuthDbContext(shared));
    }

    private static DbContextOptions<AuthDbContext> Options(string prefix, bool unique = true)
    {
        var name = unique ? $"{prefix}-{Guid.NewGuid()}" : prefix;
        return new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase(name)
            /*
             * ApprovalAppService.ApproveAsync opens a real transaction, deliberately: the status
             * flip and the replay have to be atomic or an approval can be left half-applied. The
             * in-memory provider has no transactions and raises TransactionIgnoredWarning as an
             * ERROR by default, so without this every approval test would fail on infrastructure
             * rather than on behaviour.
             *
             * What this costs is real and worth stating: these tests cannot prove the rollback. They
             * prove the ordering, the claim, and the failure handling around it; the atomicity itself
             * is asserted at the model level (see ApprovalSchemaTests) and exercised by Postgres.
             */
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;
    }
}

/// <summary>Builds an <see cref="AuditLogAppService"/> wired for tests.</summary>
internal static class TestAudit
{
    /// <param name="publisher">Pass a shared instance when a test asserts on both audit writes and
    /// the events they trigger; omit it when the test only cares that a row was written.</param>
    public static AuditLogAppService For(AuthDbContext db, IPlatformEventPublisher? publisher = null) =>
        // A real HttpContextAccessor with no HttpContext, which is the shape the service is written
        // for outside a request: correlation ids fall back to a fresh GUID and IP/User-Agent are null.
        new(db, publisher ?? new RecordingPublisher(), new HttpContextAccessor());
}

/// <summary>
/// Records every platform event instead of broadcasting it, so a test can assert the fan-out an
/// operation is supposed to produce. Never throws — matching the real publisher's contract that a
/// SignalR failure must not abort a committed database operation.
/// </summary>
internal sealed class RecordingPublisher : IPlatformEventPublisher
{
    public List<PlatformEvent> ApprovalViewerEvents { get; } = [];
    public List<PlatformEvent> AuditViewerEvents { get; } = [];
    public List<PlatformEvent> CheckerAssignmentViewerEvents { get; } = [];
    public List<(IReadOnlyList<Guid> UserIds, PlatformEvent Event)> UserEvents { get; } = [];
    public List<(Guid UserId, int PendingCount)> Badges { get; } = [];
    public int KpiRefreshRequests { get; private set; }

    public Task PublishToApprovalViewersAsync(PlatformEvent @event, CancellationToken ct = default)
    {
        ApprovalViewerEvents.Add(@event);
        return Task.CompletedTask;
    }

    public Task PublishToAuditViewersAsync(PlatformEvent @event, CancellationToken ct = default)
    {
        AuditViewerEvents.Add(@event);
        return Task.CompletedTask;
    }

    public Task PublishToCheckerAssignmentViewersAsync(PlatformEvent @event, CancellationToken ct = default)
    {
        CheckerAssignmentViewerEvents.Add(@event);
        return Task.CompletedTask;
    }

    public Task PublishToUsersAsync(IEnumerable<Guid> userIds, PlatformEvent @event, CancellationToken ct = default)
    {
        UserEvents.Add((userIds.ToList(), @event));
        return Task.CompletedTask;
    }

    public Task PublishBadgeAsync(Guid userId, int pendingCount, CancellationToken ct = default)
    {
        Badges.Add((userId, pendingCount));
        return Task.CompletedTask;
    }

    public void RequestKpiRefresh() => KpiRefreshRequests++;

    /// <summary>The most recent badge count published for a user, or null if none was.</summary>
    public int? LatestBadgeFor(Guid userId) =>
        Badges.Where(b => b.UserId == userId).Select(b => (int?)b.PendingCount).LastOrDefault();
}
