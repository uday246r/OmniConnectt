using AuthService.Application.DTOs;
using AuthService.Application.Exceptions;
using AuthService.Application.Services;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// The maker side of Maker-Checker: deciding whether a module is gated, choosing who must approve,
/// and refusing the submissions that must not be queued.
/// </summary>
/// <remarks>
/// <para>
/// This engine had no direct test coverage at all. Its behaviour is heavily documented in comments
/// and the documentation is good, but a comment describing an invariant is not the same thing as an
/// invariant — and the invariants here are the ones that stop a change reaching production without a
/// second person seeing it. Every rule below was previously enforced only by reading.
/// </para>
/// <para>
/// The selection rules in particular are easy to break invisibly. Excluding the maker, expanding a
/// role to its CURRENT active members, counting workload per module rather than globally: get any of
/// them subtly wrong and the system still approves things, just by the wrong people or in the wrong
/// order, with nothing failing.
/// </para>
/// </remarks>
public class ApprovalGatingServiceTests : IDisposable
{
    private const string Module = "host.settings.users";

    private readonly AuthDbContext db;
    private readonly ApprovalGatingService gating;
    private readonly RecordingPublisher events;

    public ApprovalGatingServiceTests()
    {
        db = TestDb.Create("approval-gating");
        events = new RecordingPublisher();
        gating = new ApprovalGatingService(db, TestAudit.For(db, events), events);
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    // ── Is the module gated at all ───────────────────────────────────────────

    /// <summary>
    /// Gating is derived, not configured: a module is gated because someone is assigned to check it,
    /// and un-gated because nobody is. There is no separate on/off switch to fall out of step with
    /// the assignment list.
    /// </summary>
    [Fact]
    public async Task A_module_with_no_checker_assigned_is_not_gated()
    {
        Assert.False(await gating.IsGatedAsync(Module));

        await AssignCheckerAsync(await AddUserAsync("Checker"));

        Assert.True(await gating.IsGatedAsync(Module));
    }

    [Fact]
    public async Task Removing_the_last_assignment_un_gates_the_module()
    {
        var assignment = await AssignCheckerAsync(await AddUserAsync("Checker"));

        db.CheckerAssignments.Remove(assignment);
        await db.SaveChangesAsync();

        Assert.False(await gating.IsGatedAsync(Module));
    }

    /// <summary>
    /// A gated mutation that cannot be attributed to anyone is refused rather than allowed through.
    ///
    /// Every gating check reads "not bypassed AND there is an acting user AND the module is gated",
    /// so a null acting user falls straight past the gate to the direct-mutation path — a bypass that
    /// leaves no maker to record. It should be unreachable behind [Authorize], and failing loudly is
    /// the only safe reading if it ever is not: an approval workflow with no identifiable maker is
    /// not an approval workflow.
    /// </summary>
    [Fact]
    public async Task An_unattributable_mutation_on_a_gated_module_is_refused()
    {
        await AssignCheckerAsync(await AddUserAsync("Checker"));

        await Assert.ThrowsAsync<ForbiddenAppException>(
            () => gating.EnsureActorIdentifiedAsync(Module, actingUserId: null));
    }

    [Fact]
    public async Task An_unattributable_mutation_on_an_un_gated_module_is_allowed_through()
    {
        // No assignment, so nothing to attribute a request to in the first place.
        await gating.EnsureActorIdentifiedAsync(Module, actingUserId: null);
    }

    // ── Choosing the checker ─────────────────────────────────────────────────

    /// <summary>
    /// The rule the whole system exists for. A maker who is also the module's only checker must not
    /// be quietly handed their own request to approve — the mutation is refused instead.
    /// </summary>
    [Fact]
    public async Task A_maker_who_is_the_only_eligible_checker_cannot_submit_at_all()
    {
        var maker = await AddUserAsync("Solo");
        await AssignCheckerAsync(maker);

        var error = await Assert.ThrowsAsync<ConflictAppException>(
            () => gating.SubmitAsync(Module, "Update", "User", "u1", "Some User", null, "{}", maker.Id));

        Assert.Contains("other than yourself", error.Message);
    }

    [Fact]
    public async Task A_module_whose_checkers_are_all_inactive_refuses_the_submission()
    {
        var maker = await AddUserAsync("Maker");
        var checker = await AddUserAsync("Dormant", UserStatus.Inactive);
        await AssignCheckerAsync(checker);

        var error = await Assert.ThrowsAsync<ConflictAppException>(
            () => gating.SubmitAsync(Module, "Update", "User", "u1", "Some User", null, "{}", maker.Id));

        Assert.Contains("currently inactive", error.Message);
    }

    /// <summary>
    /// Workload balancing, and it is counted PER MODULE. Counting globally made a checker who was
    /// busy on one module look busy on every other, which an administrator seeing only one module's
    /// queue cannot explain.
    /// </summary>
    [Fact]
    public async Task The_checker_with_the_fewest_pending_requests_on_this_module_is_chosen()
    {
        var maker = await AddUserAsync("Maker");
        var busy = await AddUserAsync("Busy");
        var free = await AddUserAsync("Free");
        await AssignCheckerAsync(busy);
        await AssignCheckerAsync(free);

        // Two pending on this module for `busy`, and one on a DIFFERENT module for `free` — which
        // must not count against them here.
        await SeedPendingAsync(Module, busy.Id, maker.Id, "existing-1");
        await SeedPendingAsync(Module, busy.Id, maker.Id, "existing-2");
        await SeedPendingAsync("host.settings.roles", free.Id, maker.Id, "other-module");

        var pending = await gating.SubmitAsync(Module, "Update", "User", "u9", "Some User", null, "{}", maker.Id);

        Assert.Equal("Free", pending.CheckerName);
    }

    /// <summary>
    /// Role assignments resolve to whoever holds the role NOW. Freezing membership at assignment time
    /// is the failure this design exists to avoid: a new team member could not act, and a departed
    /// one still could.
    /// </summary>
    [Fact]
    public async Task A_role_assignment_expands_to_the_roles_current_active_members()
    {
        var role = await AddRoleAsync("Approvers");
        var maker = await AddUserAsync("Maker");
        var member = await AddUserAsync("Member", role: role);
        await AddUserAsync("Departed", UserStatus.Inactive, role);
        await AssignRoleAsync(role);

        var pending = await gating.SubmitAsync(Module, "Update", "User", "u1", "Some User", null, "{}", maker.Id);

        Assert.Equal(member.Name, pending.CheckerName);
    }

    /// <summary>
    /// A person named individually AND present in an assigned role is one candidate, not two.
    /// Counting them twice would skew the workload balancer towards them.
    /// </summary>
    [Fact]
    public async Task A_checker_assigned_both_directly_and_through_a_role_is_only_counted_once()
    {
        var role = await AddRoleAsync("Approvers");
        var maker = await AddUserAsync("Maker");
        var both = await AddUserAsync("Both", role: role);
        await AssignCheckerAsync(both);
        await AssignRoleAsync(role);

        var eligible = await gating.ResolveEligibleCheckerIdsAsync(Module, maker.Id, CancellationToken.None);

        Assert.Equal([both.Id], eligible);
    }

    /// <summary>
    /// The maker is excluded from a role expansion too, not only from a direct assignment. Otherwise
    /// "assign the Managers role as checker" would silently let a Manager approve their own change.
    /// </summary>
    [Fact]
    public async Task A_maker_inside_an_assigned_role_is_excluded_from_their_own_request()
    {
        var role = await AddRoleAsync("Approvers");
        var makerInRole = await AddUserAsync("MakerInRole", role: role);
        var colleague = await AddUserAsync("Colleague", role: role);
        await AssignRoleAsync(role);

        var eligible = await gating.ResolveEligibleCheckerIdsAsync(Module, makerInRole.Id, CancellationToken.None);

        Assert.Equal([colleague.Id], eligible);
    }

    /// <summary>
    /// Deterministic, so the same inputs always produce the same assignment. A tie broken at random
    /// would make the queue impossible to reason about, and this test impossible to write.
    /// </summary>
    [Fact]
    public async Task A_tie_on_workload_is_broken_deterministically_by_id()
    {
        var maker = await AddUserAsync("Maker");
        var first = await AddUserAsync("A", id: new Guid("11111111-1111-1111-1111-111111111111"));
        var second = await AddUserAsync("B", id: new Guid("22222222-2222-2222-2222-222222222222"));
        await AssignCheckerAsync(first);
        await AssignCheckerAsync(second);

        var chosen = await gating.TrySelectCheckerAsync(Module, [second.Id, first.Id], CancellationToken.None);

        Assert.Equal(first.Id, chosen!.Value.CheckerId);
    }

    // ── One open request per record ──────────────────────────────────────────

    /// <summary>
    /// Without this, a maker who submits a change, sees nothing happen — because nothing HAS happened,
    /// it is awaiting approval — and clicks again, silently queues a second request. Approving both
    /// replays the mutation twice.
    /// </summary>
    [Fact]
    public async Task A_second_request_against_the_same_record_by_the_same_maker_is_refused()
    {
        var maker = await AddUserAsync("Maker");
        await AssignCheckerAsync(await AddUserAsync("Checker"));

        await gating.SubmitAsync(Module, "Update", "User", "u1", "Target User", null, "{}", maker.Id);

        var error = await Assert.ThrowsAsync<PendingApprovalConflictException>(
            () => gating.SubmitAsync(Module, "Update", "User", "u1", "Target User", null, "{}", maker.Id));

        Assert.Contains("You already have", error.Message);
        Assert.True(error.Pending.IsOwnRequest);
    }

    /// <summary>
    /// The same guard across two different makers, which is the more serious case: two people each
    /// believe they own a change to one record, and the message has to name the other one so the
    /// second maker knows who to talk to rather than just being refused.
    /// </summary>
    [Fact]
    public async Task A_second_request_against_the_same_record_by_another_maker_names_the_first_maker()
    {
        var firstMaker = await AddUserAsync("First Maker");
        var secondMaker = await AddUserAsync("Second Maker");
        await AssignCheckerAsync(await AddUserAsync("Checker"));

        await gating.SubmitAsync(Module, "Update", "User", "u1", "Target User", null, "{}", firstMaker.Id);

        var error = await Assert.ThrowsAsync<PendingApprovalConflictException>(
            () => gating.SubmitAsync(Module, "Delete", "User", "u1", "Target User", null, "{}", secondMaker.Id));

        Assert.Contains("First Maker", error.Message);
        Assert.False(error.Pending.IsOwnRequest);
    }

    /// <summary>
    /// The refusal is itself recorded. Two makers racing one record is a real operational signal, and
    /// before this it produced an error message on one person's screen and nothing anywhere else.
    /// </summary>
    [Fact]
    public async Task A_refused_duplicate_submission_is_written_to_the_audit_trail()
    {
        var firstMaker = await AddUserAsync("First Maker");
        var secondMaker = await AddUserAsync("Second Maker");
        await AssignCheckerAsync(await AddUserAsync("Checker"));

        await gating.SubmitAsync(Module, "Update", "User", "u1", "Target User", null, "{}", firstMaker.Id);
        await Assert.ThrowsAsync<PendingApprovalConflictException>(
            () => gating.SubmitAsync(Module, "Update", "User", "u1", "Target User", null, "{}", secondMaker.Id));

        var conflict = await db.AuditLogs.SingleAsync(a => a.Action == "approval.submit_conflicted");

        Assert.Equal(secondMaker.Id, conflict.ActorUserId);
        Assert.Equal("Failure", conflict.Result);
        Assert.Contains("First Maker", conflict.Details);
    }

    /// <summary>
    /// A decided request stops blocking. The uniqueness rule is about requests IN FLIGHT — once the
    /// first one is approved or rejected, the record is free to be changed again.
    /// </summary>
    [Fact]
    public async Task A_decided_request_no_longer_blocks_a_new_one_for_the_same_record()
    {
        var maker = await AddUserAsync("Maker");
        await AssignCheckerAsync(await AddUserAsync("Checker"));

        var first = await gating.SubmitAsync(Module, "Update", "User", "u1", "Target User", null, "{}", maker.Id);

        var stored = await db.ApprovalRequests.SingleAsync(r => r.Id == first.ApprovalRequestId);
        stored.Status = ApprovalStatus.Rejected;
        stored.DecidedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();

        var second = await gating.SubmitAsync(Module, "Update", "User", "u1", "Target User", null, "{}", maker.Id);

        Assert.NotEqual(first.ApprovalRequestId, second.ApprovalRequestId);
    }

    /// <summary>
    /// A null key deduplicates against nothing, matching the partial unique index — Postgres treats
    /// NULLs as distinct, so the application-level check has to agree or the two layers would
    /// disagree about the same submission. This is what lets a remote module that has not adopted an
    /// entity key yet keep working.
    /// </summary>
    [Fact]
    public async Task A_request_with_no_entity_key_never_collides()
    {
        var maker = await AddUserAsync("Maker");
        await AssignCheckerAsync(await AddUserAsync("Checker"));

        await gating.SubmitAsync(Module, "Update", "User", entityId: null, "Label", null, "{}", maker.Id);
        await gating.SubmitAsync(Module, "Update", "User", entityId: null, "Label", null, "{}", maker.Id);

        Assert.Equal(2, await db.ApprovalRequests.CountAsync());
    }

    /// <summary>
    /// Create has no id yet, so it deduplicates on the natural key the module already enforces as
    /// unique. Without it two makers could both queue "create foo@bar", and the second would fail at
    /// approval time with a duplicate-email error the checker can do nothing about.
    /// </summary>
    [Fact]
    public async Task A_create_deduplicates_on_its_natural_key_rather_than_an_id_it_does_not_have()
    {
        var maker = await AddUserAsync("Maker");
        await AssignCheckerAsync(await AddUserAsync("Checker"));

        await gating.SubmitAsync(Module, "Create", "User", null, "New Person", null, "{}", maker.Id, entityKey: "new@example.com");

        await Assert.ThrowsAsync<PendingApprovalConflictException>(
            () => gating.SubmitAsync(Module, "Create", "User", null, "New Person", null, "{}", maker.Id, entityKey: "new@example.com"));
    }

    // ── What a submission records and announces ──────────────────────────────

    [Fact]
    public async Task Submitting_records_the_request_and_tells_the_maker_and_the_checker()
    {
        var maker = await AddUserAsync("Maker");
        var checker = await AddUserAsync("Checker");
        await AssignCheckerAsync(checker);

        var pending = await gating.SubmitAsync(Module, "Delete", "User", "u1", "Target User", null, "{}", maker.Id);

        var request = await db.ApprovalRequests.SingleAsync();
        Assert.Equal(ApprovalStatus.Pending, request.Status);
        Assert.Equal(maker.Id, request.MakerId);
        Assert.Equal(checker.Id, request.CheckerId);
        // Denormalised, so the trail survives the account being deleted later.
        Assert.Equal("Maker", request.MakerName);
        Assert.Equal("Checker", request.CheckerName);

        var audit = await db.AuditLogs.SingleAsync(a => a.Action == "approval.requested");
        Assert.Equal(maker.Id, audit.ActorUserId);
        Assert.Equal(request.CorrelationId, audit.CorrelationId);

        // Both parties are notified, and the checker's badge reflects their new queue depth.
        var notified = Assert.Single(events.UserEvents);
        Assert.Contains(maker.Id, notified.UserIds);
        Assert.Contains(checker.Id, notified.UserIds);
        Assert.Equal(1, events.LatestBadgeFor(checker.Id));
        Assert.Equal(pending.ApprovalRequestId, request.Id);
    }

    /// <summary>
    /// A remote service's submission carries its own callback URL and correlation id, which is what
    /// lets AuthService replay the mutation back into the service that owns it.
    /// </summary>
    [Fact]
    public async Task A_remote_submission_keeps_its_own_source_callback_and_correlation_id()
    {
        var maker = await AddUserAsync("Maker");
        await AssignCheckerAsync(await AddUserAsync("Checker"), "remote.lead");

        await gating.SubmitAsync(
            "remote.lead", "Create", "Lead", null, "Acme Corp", null, "{}", maker.Id,
            sourceService: "LeadService",
            callbackUrl: "http://lead:5046/internal/approvals/apply",
            correlationId: "lead-corr-1",
            entityKey: "lead:ic-123:mortgage");

        var request = await db.ApprovalRequests.SingleAsync();
        Assert.Equal("LeadService", request.SourceService);
        Assert.Equal("http://lead:5046/internal/approvals/apply", request.CallbackUrl);
        Assert.Equal("lead-corr-1", request.CorrelationId);
        Assert.Equal("lead:ic-123:mortgage", request.EntityKey);
    }

    // ── A checker leaving ────────────────────────────────────────────────────

    /// <summary>
    /// Deactivating a checker used to strand their queue: the request stayed Pending and assigned to
    /// someone who could no longer sign in, only the assigned checker may act, and the maker saw a
    /// request that never resolved with nobody able to explain why.
    /// </summary>
    [Fact]
    public async Task Deactivating_a_checker_moves_their_pending_requests_to_someone_who_can_act()
    {
        var maker = await AddUserAsync("Maker");
        var departing = await AddUserAsync("Departing");
        var replacement = await AddUserAsync("Replacement");
        await AssignCheckerAsync(departing);
        await AssignCheckerAsync(replacement);

        var request = await SeedPendingAsync(Module, departing.Id, maker.Id, "u1");

        await gating.ReassignPendingRequestsForDepartingCheckerAsync(
            departing.Id, maker.Id, "their account was deactivated", CancellationToken.None);
        await db.SaveChangesAsync();

        var reassigned = await db.ApprovalRequests.SingleAsync(r => r.Id == request.Id);
        Assert.Equal(replacement.Id, reassigned.CheckerId);

        var audit = await db.AuditLogs.SingleAsync(a => a.Action == "approval.reassigned");
        Assert.Contains("Departing", audit.Details);
        Assert.Contains("Replacement", audit.Details);
    }

    /// <summary>
    /// When there is nobody to hand the queue to, the departure is REFUSED rather than allowed to
    /// strand it. Blocking an account change is recoverable; an approval nobody can ever decide is
    /// not.
    /// </summary>
    [Fact]
    public async Task Deactivating_the_only_checker_is_refused_rather_than_stranding_the_queue()
    {
        var maker = await AddUserAsync("Maker");
        var onlyChecker = await AddUserAsync("Only Checker");
        await AssignCheckerAsync(onlyChecker);
        await SeedPendingAsync(Module, onlyChecker.Id, maker.Id, "u1");

        var error = await Assert.ThrowsAsync<ConflictAppException>(
            () => gating.ReassignPendingRequestsForDepartingCheckerAsync(
                onlyChecker.Id, maker.Id, "their account was deactivated", CancellationToken.None));

        Assert.Contains("no other", error.Message);
    }

    /// <summary>
    /// A replacement who happens to be the request's own maker would reintroduce exactly the
    /// self-approval the system exists to prevent — so they are excluded, and if they are the only
    /// candidate the departure is refused instead.
    /// </summary>
    [Fact]
    public async Task A_reassignment_never_hands_a_request_to_its_own_maker()
    {
        var maker = await AddUserAsync("Maker");
        var departing = await AddUserAsync("Departing");
        await AssignCheckerAsync(departing);
        // The maker is also an assigned checker for this module — legitimate, since they check OTHER
        // people's requests here. They still must not receive their own.
        await AssignCheckerAsync(maker);
        await SeedPendingAsync(Module, departing.Id, maker.Id, "u1");

        await Assert.ThrowsAsync<ConflictAppException>(
            () => gating.ReassignPendingRequestsForDepartingCheckerAsync(
                departing.Id, maker.Id, "their account was deactivated", CancellationToken.None));
    }

    /// <summary>
    /// Deactivating an account removes someone from every module at once, so the sweep has to cover
    /// all of them rather than the one that happened to be looked at.
    /// </summary>
    [Fact]
    public async Task Reassignment_covers_every_module_the_departing_checker_holds()
    {
        const string otherModule = "host.settings.roles";
        var maker = await AddUserAsync("Maker");
        var departing = await AddUserAsync("Departing");
        var replacement = await AddUserAsync("Replacement");

        await AssignCheckerAsync(departing);
        await AssignCheckerAsync(replacement);
        await AssignCheckerAsync(departing, otherModule);
        await AssignCheckerAsync(replacement, otherModule);

        await SeedPendingAsync(Module, departing.Id, maker.Id, "u1");
        await SeedPendingAsync(otherModule, departing.Id, maker.Id, "r1");

        await gating.ReassignPendingRequestsForDepartingCheckerAsync(
            departing.Id, maker.Id, "their account was deactivated", CancellationToken.None);
        await db.SaveChangesAsync();

        Assert.Empty(await db.ApprovalRequests.Where(r => r.CheckerId == departing.Id).ToListAsync());
        Assert.Equal(2, await db.ApprovalRequests.CountAsync(r => r.CheckerId == replacement.Id));
    }

    [Fact]
    public async Task A_departing_checker_with_nothing_pending_needs_no_reassignment()
    {
        var departing = await AddUserAsync("Departing");
        await AssignCheckerAsync(departing);

        await gating.ReassignPendingRequestsForDepartingCheckerAsync(
            departing.Id, null, "their account was deactivated", CancellationToken.None);

        Assert.Empty(await db.AuditLogs.ToListAsync());
    }

    // ── Fixtures ─────────────────────────────────────────────────────────────

    private async Task<User> AddUserAsync(
        string name, UserStatus status = UserStatus.Active, Role? role = null, Guid? id = null)
    {
        var user = new User
        {
            Id = id ?? Guid.NewGuid(),
            Name = name,
            Email = $"{name.Replace(" ", "").ToLowerInvariant()}@example.com",
            Status = status,
            RoleId = role?.Id,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    private async Task<Role> AddRoleAsync(string name)
    {
        var role = new Role
        {
            Id = Guid.NewGuid(),
            Name = name,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Roles.Add(role);
        await db.SaveChangesAsync();
        return role;
    }

    private async Task<CheckerAssignment> AssignCheckerAsync(User checker, string module = Module)
    {
        var assignment = new CheckerAssignment
        {
            Id = Guid.NewGuid(),
            Module = module,
            CheckerUserId = checker.Id,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.CheckerAssignments.Add(assignment);
        await db.SaveChangesAsync();
        return assignment;
    }

    private async Task AssignRoleAsync(Role role, string module = Module)
    {
        db.CheckerAssignments.Add(new CheckerAssignment
        {
            Id = Guid.NewGuid(),
            Module = module,
            CheckerRoleId = role.Id,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    private async Task<ApprovalRequest> SeedPendingAsync(string module, Guid checkerId, Guid makerId, string entityKey)
    {
        var request = new ApprovalRequest
        {
            Id = Guid.NewGuid(),
            Module = module,
            Action = "Update",
            EntityType = "User",
            EntityId = entityKey,
            EntityKey = entityKey,
            EntityLabel = entityKey,
            NewDataJson = "{}",
            Status = ApprovalStatus.Pending,
            MakerId = makerId,
            MakerName = "Maker",
            CheckerId = checkerId,
            CheckerName = (await db.Users.FindAsync(checkerId))?.Name,
            RequestedAt = DateTimeOffset.UtcNow,
            SourceService = "AuthService",
            CorrelationId = Guid.NewGuid().ToString(),
        };
        db.ApprovalRequests.Add(request);
        await db.SaveChangesAsync();
        return request;
    }
}
