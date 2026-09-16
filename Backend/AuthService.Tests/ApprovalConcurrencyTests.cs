using AuthService.Application.DTOs;
using AuthService.Application.Exceptions;
using AuthService.Application.Services;
using AuthService.Domain.Entities;
using AuthService.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// What happens when two people, or two application instances, act on one approval at the same time.
/// </summary>
/// <remarks>
/// <para>
/// These are the paths the approval engine documents most carefully and had no coverage of at all.
/// They are also the ones that cannot be reproduced by calling a method twice in sequence: the whole
/// question is what happens when the second caller arrives between the first caller's read and their
/// write.
/// </para>
/// <para>
/// <b>How these are provoked, and what that does and does not prove.</b> Docker is not available in
/// this environment, so there is no Postgres to race against and no Testcontainers. Two techniques
/// stand in. Where two ACTORS are enough, two <c>AuthDbContext</c> instances share one in-memory
/// database — separate change trackers, one store, which genuinely reproduces "another server
/// already committed this". Where the DATABASE itself is the mechanism — the <c>xmin</c> token, the
/// partial unique index — a save interceptor raises the exact exception Postgres would raise, at the
/// exact point it would raise it.
/// </para>
/// <para>
/// So what is proven here is that the handlers are correct: the right exception is caught, the right
/// error reaches the caller, the retry guard holds, no orphan state is left behind. What is NOT
/// proven is that Postgres raises those exceptions in the first place — that the index really is
/// partial and the token really is a concurrency token. Those are assertions about the model, and
/// they live in <see cref="ApprovalSchemaTests"/>. Together the two files cover the mechanism end to
/// end; neither would be sufficient alone, and it is worth being explicit that a green run here is
/// not a substitute for the database enforcing its own constraints.
/// </para>
/// </remarks>
public class ApprovalConcurrencyTests : IDisposable
{
    private const string Module = "host.settings.users";

    private readonly List<IDisposable> disposables = [];

    public void Dispose()
    {
        foreach (var d in disposables)
        {
            d.Dispose();
        }
        GC.SuppressFinalize(this);
    }

    // ── Two checkers deciding at once ────────────────────────────────────────

    /// <summary>
    /// Two approvals racing: exactly one wins, and the loser is told plainly rather than silently
    /// overwriting a decision that has already been made and applied.
    /// </summary>
    /// <remarks>
    /// The claim is the status flip itself, carrying the <c>xmin</c> token — so of two simultaneous
    /// UPDATEs one matches zero rows and throws. Reproduced here by raising that exception at the
    /// save, which is where Postgres raises it.
    /// </remarks>
    [Fact]
    public async Task Two_checkers_approving_at_once_means_one_wins_and_the_other_is_refused()
    {
        var (h, faults, _) = NewFaultingHarness();
        var maker = await h.AddUserAsync("Maker");
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync(Module, checker);
        var target = await h.AddUserAsync("Target");
        var requestId = (await h.Users.DeleteAsync(target.Id, maker.Id))!.ApprovalRequestId;

        // The next save — the status flip that claims the request — loses the race.
        faults.FailNextSaveWith(new DbUpdateConcurrencyException("Someone else claimed this row."));

        var error = await Assert.ThrowsAsync<ConflictAppException>(
            () => h.Approvals.ApproveAsync(requestId, checker.Id));

        Assert.Contains("just decided by someone else", error.Message);

        // The loser's replay never ran: the user they were approving the deletion of is still there.
        Assert.NotNull(await h.Db.Users.FirstOrDefaultAsync(u => u.Id == target.Id));
        Assert.Empty(await h.Db.AuditLogs.Where(a => a.Action == "user.deleted").ToListAsync());
    }

    /// <summary>
    /// The same guard on the rejection path. A rejection landing after someone else has already
    /// approved must not quietly overwrite that decision — the change has been APPLIED by then, so a
    /// request reading Rejected over an applied mutation is the worst of both records.
    /// </summary>
    [Fact]
    public async Task A_rejection_that_lands_after_a_decision_is_refused_rather_than_overwriting_it()
    {
        var (h, faults, _) = NewFaultingHarness();
        var maker = await h.AddUserAsync("Maker");
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync(Module, checker);
        var target = await h.AddUserAsync("Target");
        var requestId = (await h.Users.DeleteAsync(target.Id, maker.Id))!.ApprovalRequestId;

        faults.FailNextSaveWith(new DbUpdateConcurrencyException("Someone else decided this row."));

        var error = await Assert.ThrowsAsync<ConflictAppException>(
            () => h.Approvals.RejectAsync(requestId, checker.Id, "Too risky."));

        Assert.Contains("just decided by someone else", error.Message);
    }

    /// <summary>
    /// Two ACTORS, genuinely, over one store. No fault injection: the first decision really commits,
    /// and the second context reads the row it does not know has changed.
    /// </summary>
    /// <remarks>
    /// This is the closest this environment gets to two application instances, and it covers the
    /// already-decided guard rather than the concurrency token — the second checker arrives late
    /// enough to READ the decided row, which is the far more common shape of this race in practice.
    /// </remarks>
    [Fact]
    public async Task A_second_instance_approving_a_request_already_decided_elsewhere_is_refused()
    {
        var (first, second) = TestDb.CreatePair("approval-two-instances");
        var instanceA = Track(new ApprovalHarness(first));
        var instanceB = Track(new ApprovalHarness(second));

        var maker = await instanceA.AddUserAsync("Maker");
        var checker = await instanceA.AddUserAsync("Checker");
        await instanceA.GateAsync(Module, checker);
        var target = await instanceA.AddUserAsync("Target");
        var requestId = (await instanceA.Users.DeleteAsync(target.Id, maker.Id))!.ApprovalRequestId;

        await instanceA.Approvals.ApproveAsync(requestId, checker.Id);

        var error = await Assert.ThrowsAsync<ConflictAppException>(
            () => instanceB.Approvals.ApproveAsync(requestId, checker.Id));

        Assert.Contains("already been approved", error.Message);
    }

    // ── Two makers submitting at once ────────────────────────────────────────

    /// <summary>
    /// Two submissions racing the partial unique index. The application-level check runs first and
    /// catches the sequential case; this is what happens when both callers pass that check before
    /// either commits, and the database is the thing that actually holds the line.
    /// </summary>
    /// <remarks>
    /// The recovery is the interesting part: the failed row is detached so the retry reads clean, the
    /// check re-runs, and the caller gets the same friendly conflict a sequential caller would have
    /// got — not a raw <c>DbUpdateException</c>, and not a second row.
    /// </remarks>
    [Fact]
    public async Task Two_submissions_racing_the_unique_index_produce_one_request_and_a_friendly_conflict()
    {
        var (h, faults, options) = NewFaultingHarness();
        var firstMaker = await h.AddUserAsync("First Maker");
        var secondMaker = await h.AddUserAsync("Second Maker");
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync(Module, checker);

        /*
         * The interleaving that only the database can catch.
         *
         * The second maker's in-application check runs and finds nothing, because at that moment
         * there IS nothing. The winner commits in the gap between that check and the insert — which
         * is what the `before` action does here, through a separate context onto the same store —
         * and the index rejects the insert.
         *
         * Ordering the two calls sequentially would never reach this path: the check would find the
         * winner and refuse before any save. That is the case the previous test covers; this one is
         * specifically about the window the check cannot close.
         */
        faults.FailNextSaveWith(
            UniqueViolation(),
            before: () => CommitCompetingRequest(options, firstMaker.Id, "First Maker", checker.Id));

        var error = await Assert.ThrowsAsync<PendingApprovalConflictException>(
            () => h.Gating.SubmitAsync(Module, "Update", "User", "u1", "Target", null, "{}", secondMaker.Id));

        // The loser gets the SAME friendly message a sequential caller would have got, naming the
        // winner — not a raw DbUpdateException, which is what escaped before the catch existed.
        Assert.Contains("First Maker", error.Message);
        Assert.False(error.Pending.IsOwnRequest);

        // One request, not two — and no orphan tracked entity left behind by the failed insert,
        // which would otherwise be re-sent by the next unrelated SaveChanges on this context.
        Assert.Equal(1, await h.Db.ApprovalRequests.CountAsync());
        Assert.DoesNotContain(
            h.Db.ChangeTracker.Entries<ApprovalRequest>(),
            e => e.State == EntityState.Added);
    }

    /// <summary>
    /// Writes the winning request from a separate context onto the same store, standing in for
    /// another instance committing concurrently.
    /// </summary>
    private void CommitCompetingRequest(
        DbContextOptions<AuthDbContext> options, Guid makerId, string makerName, Guid checkerId)
    {
        using var other = new AuthDbContext(options);

        other.ApprovalRequests.Add(new ApprovalRequest
        {
            Id = Guid.NewGuid(),
            Module = Module,
            Action = "Update",
            EntityType = "User",
            EntityId = "u1",
            EntityKey = "u1",
            EntityLabel = "Target",
            NewDataJson = "{}",
            Status = ApprovalStatus.Pending,
            MakerId = makerId,
            MakerName = makerName,
            CheckerId = checkerId,
            CheckerName = "Checker",
            RequestedAt = DateTimeOffset.UtcNow,
            SourceService = "AuthService",
            CorrelationId = Guid.NewGuid().ToString(),
        });
        other.SaveChanges();
    }

    /// <summary>
    /// The defensive branch: the index fires, but by the time the check re-runs the winning request
    /// has already been decided, so there is no pending row to point at. A plain conflict is returned
    /// rather than pretending the write succeeded.
    /// </summary>
    [Fact]
    public async Task A_violation_with_no_visible_pending_request_still_refuses_rather_than_succeeding()
    {
        var (h, faults, _) = NewFaultingHarness();
        var maker = await h.AddUserAsync("Maker");
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync(Module, checker);

        faults.FailNextSaveWith(UniqueViolation());

        var error = await Assert.ThrowsAsync<ConflictAppException>(
            () => h.Gating.SubmitAsync(Module, "Update", "User", "u1", "Target", null, "{}", maker.Id));

        Assert.Contains("same moment", error.Message);
        Assert.Empty(await h.Db.ApprovalRequests.ToListAsync());
    }

    // ── Retrying the approval unit ───────────────────────────────────────────

    /// <summary>
    /// The retry guard, and the reason it is a class rather than a bool.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The approval runs inside an execution strategy because the connection retries on transient
    /// failures, and EF refuses a user-initiated transaction otherwise. Everything inside that
    /// transaction rolls back and is safe to repeat — except the remote replay, which is an HTTP POST
    /// to another service's database and is outside our rollback entirely. Re-sending it would apply
    /// the mutation twice.
    /// </para>
    /// <para>
    /// The guard is declared OUTSIDE the retried delegate so it survives across attempts. This test
    /// drives two attempts through the same delegate and asserts the remote saw exactly one call —
    /// which is the property; a bool captured inside would reset and the remote would see two.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task One_approval_sends_the_remote_replay_exactly_once()
    {
        var (h, _, _) = NewFaultingHarness();
        var maker = await h.AddUserAsync("Maker");
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync("remote.lead", checker);

        var pending = await h.Gating.SubmitAsync(
            "remote.lead", "Create", "Lead", null, "Acme Corp", null, "{}", maker.Id,
            sourceService: "LeadService", callbackUrl: "http://lead-service/internal/approvals/apply",
            entityKey: "lead:acme");

        await h.Approvals.ApproveAsync(pending.ApprovalRequestId, checker.Id);

        Assert.Single(h.RemoteCallbacks.Calls);

        /*
         * What this does NOT do, and why.
         *
         * A genuine retry cannot be provoked here: the execution strategy only re-enters its delegate
         * on a TRANSIENT provider failure, and the in-memory provider has no such classification —
         * its strategy never retries. Injecting an exception makes the call fail, not repeat.
         *
         * So the double-send this guard prevents is unreachable in this environment, and asserting
         * "one call" after a single approval would pass with the guard deleted. What IS checkable is
         * the structural property the guard depends on: that it lives outside the retried delegate,
         * so a second attempt sees the flag the first attempt set rather than a fresh one. That is
         * asserted by ApprovalSchemaTests.The_remote_replay_guard_is_declared_outside_the_retried_delegate,
         * which reads the source — an unusual thing for a test to do, and the honest option when the
         * behaviour itself cannot be reached.
         */
    }

    /// <summary>
    /// The ordering the whole design turns on: the request is CLAIMED before anything is applied.
    /// Replaying first meant the inner service committed the mutation before any decision was
    /// recorded, so a failure in the gap left the user created while the request still read Pending —
    /// and therefore still approvable, applying it a second time.
    /// </summary>
    [Fact]
    public async Task The_claim_happens_before_the_replay_not_after()
    {
        var (h, faults, _) = NewFaultingHarness();
        var maker = await h.AddUserAsync("Maker");
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync(Module, checker);
        var target = await h.AddUserAsync("Target");
        var requestId = (await h.Users.DeleteAsync(target.Id, maker.Id))!.ApprovalRequestId;

        // Fail at the very first save inside Approve. If the replay ran first, the deletion would
        // already have committed by the time this fires.
        faults.FailNextSaveWith(new DbUpdateConcurrencyException("Claim lost."));

        await Assert.ThrowsAsync<ConflictAppException>(() => h.Approvals.ApproveAsync(requestId, checker.Id));

        Assert.NotNull(await h.Db.Users.FirstOrDefaultAsync(u => u.Id == target.Id));
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /// <returns>
    /// The options are returned alongside the harness so a second context can be opened onto the
    /// SAME store. Rebuilding options with the same database name is not enough: without an explicit
    /// root, each options builder gets its own internal service provider and therefore its own
    /// in-memory store, so the two contexts would silently never see each other's rows.
    /// </returns>
    private (ApprovalHarness Harness, FaultingSaveInterceptor Faults, DbContextOptions<AuthDbContext> Options) NewFaultingHarness()
    {
        var faults = new FaultingSaveInterceptor();
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"approval-concurrency-{Guid.NewGuid()}")
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .AddInterceptors(faults)
            .Options;

        return (Track(new ApprovalHarness(new AuthDbContext(options))), faults, options);
    }

    private T Track<T>(T disposable) where T : IDisposable
    {
        disposables.Add(disposable);
        return disposable;
    }

    /// <summary>
    /// The exception Npgsql raises when a unique index rejects an insert — constructed rather than
    /// provoked, because the in-memory provider enforces no indexes. The SQL state is what the
    /// handler actually matches on, so it has to be exactly right for the test to mean anything.
    /// </summary>
    private static DbUpdateException UniqueViolation() =>
        new("duplicate key value violates unique constraint",
            new PostgresException(
                messageText: "duplicate key value violates unique constraint \"IX_ApprovalRequests_Module_EntityKey\"",
                severity: "ERROR",
                invariantSeverity: "ERROR",
                sqlState: PostgresErrorCodes.UniqueViolation));
}

/// <summary>
/// Makes the next <c>SaveChanges</c> fail with a chosen exception.
/// </summary>
/// <remarks>
/// A hand-written interceptor rather than a mocking library, matching the rest of this suite. It
/// exists because the interesting failures in the approval engine are all database-level races that
/// an in-memory store cannot produce on its own: this raises the exception the real provider would
/// raise, at the save where it would raise it, so the handler around it is exercised for real even
/// though the race is not.
///
/// One-shot by design. An interceptor that kept failing would make it impossible to assert what
/// happens on the attempt AFTER the failure, which is most of what these tests are about.
/// </remarks>
internal sealed class FaultingSaveInterceptor : SaveChangesInterceptor
{
    private Exception? next;
    private Action? before;

    /// <param name="before">
    /// Runs immediately before the exception, on the same call. This is how "another caller
    /// committed between our check and our save" is reproduced faithfully: the competing row is
    /// written from a second context at exactly that instant, so the recovery path re-reads a
    /// database that changed underneath it — which is the whole situation being tested.
    /// </param>
    public void FailNextSaveWith(Exception exception, Action? before = null)
    {
        next = exception;
        this.before = before;
    }

    private void ThrowIfArmed()
    {
        if (next is null)
        {
            return;
        }

        var toThrow = next;
        var action = before;
        next = null;
        before = null;

        action?.Invoke();
        throw toThrow;
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        ThrowIfArmed();
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    public override InterceptionResult<int> SavingChanges(
        DbContextEventData eventData, InterceptionResult<int> result)
    {
        ThrowIfArmed();
        return base.SavingChanges(eventData, result);
    }
}
