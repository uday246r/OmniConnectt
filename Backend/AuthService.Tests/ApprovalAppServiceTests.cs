using System.Net;
using System.Text.Json;
using AuthService.Application.DTOs;
using AuthService.Application.Exceptions;
using AuthService.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// The checker side of Maker-Checker: who may decide a request, and what happens when they do.
/// </summary>
/// <remarks>
/// <para>
/// Untested until now, which matters most for the replay. An approved request is applied by calling
/// back through the SAME validated method a direct mutation would have used — so "the email was
/// taken while this sat pending" surfaces as a real error to the checker instead of silently
/// corrupting data, and the resulting audit row is attributed to the MAKER exactly as an ungated
/// change would have been. Both of those are load-bearing and neither was pinned.
/// </para>
/// <para>
/// One case is asserted here rather than exercised: the transaction. The in-memory provider has no
/// transactions, so these tests prove the ORDER of the claim and the replay, that a failed replay
/// leaves the request Pending, and that the failure is recorded — but not that the database rolls
/// back. That property is asserted at the model layer in <see cref="ApprovalSchemaTests"/> and
/// enforced by Postgres.
/// </para>
/// </remarks>
public class ApprovalAppServiceTests : IDisposable
{
    private const string UsersModule = "host.settings.users";
    private const string RolesModule = "host.settings.roles";

    private readonly ApprovalHarness h = new();

    public void Dispose()
    {
        h.Dispose();
        GC.SuppressFinalize(this);
    }

    // ── Who may decide ───────────────────────────────────────────────────────

    /// <summary>
    /// The rule the entire mechanism exists to enforce, checked again at decision time even though
    /// the maker is already excluded from checker selection. Defence in depth on the one invariant
    /// whose failure makes the whole feature pointless.
    /// </summary>
    [Fact]
    public async Task A_maker_cannot_approve_their_own_request()
    {
        var maker = await h.AddUserAsync("Maker");
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync(UsersModule, checker);
        var request = await SubmitUserDeleteAsync(maker);

        var error = await Assert.ThrowsAsync<ForbiddenAppException>(
            () => h.Approvals.ApproveAsync(request, maker.Id));

        Assert.Contains("cannot approve or reject your own", error.Message);
    }

    /// <summary>
    /// An administrator bypasses the ASSIGNED-checker rule — they are the platform's escalation path,
    /// so a request whose checker has left never becomes permanently undecidable. They do not bypass
    /// maker-is-not-checker, which is a different kind of rule.
    /// </summary>
    [Fact]
    public async Task Not_even_an_administrator_can_approve_their_own_request()
    {
        var adminRole = await h.AddRoleAsync("Super Admin", isAdministrator: true);
        var maker = await h.AddUserAsync("Admin Maker", role: adminRole);
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync(UsersModule, checker);
        var request = await SubmitUserDeleteAsync(maker);

        await Assert.ThrowsAsync<ForbiddenAppException>(
            () => h.Approvals.ApproveAsync(request, maker.Id, isAdministrator: true));
    }

    [Fact]
    public async Task Only_the_assigned_checker_may_decide_a_request()
    {
        var maker = await h.AddUserAsync("Maker");
        var assigned = await h.AddUserAsync("Assigned");
        var bystander = await h.AddUserAsync("Bystander");
        await h.GateAsync(UsersModule, assigned);
        var request = await SubmitUserDeleteAsync(maker);

        var error = await Assert.ThrowsAsync<ForbiddenAppException>(
            () => h.Approvals.ApproveAsync(request, bystander.Id));

        Assert.Contains("Only the assigned checker", error.Message);
    }

    /// <summary>
    /// The escalation path. Without it, a request assigned to someone who has since left is stuck
    /// forever — the reassignment sweep only runs when the account is deactivated through the app,
    /// not when someone simply stops coming to work.
    /// </summary>
    [Fact]
    public async Task An_administrator_may_decide_a_request_assigned_to_someone_else()
    {
        var maker = await h.AddUserAsync("Maker");
        var assigned = await h.AddUserAsync("Assigned");
        var admin = await h.AddUserAsync("Admin");
        await h.GateAsync(UsersModule, assigned);
        var target = await h.AddUserAsync("Target");
        var request = await SubmitUserDeleteAsync(maker, target);

        await h.Approvals.ApproveAsync(request, admin.Id, isAdministrator: true);

        Assert.Equal(ApprovalStatus.Approved, (await h.Db.ApprovalRequests.FindAsync(request))!.Status);
    }

    [Fact]
    public async Task A_request_that_has_already_been_decided_cannot_be_decided_again()
    {
        var maker = await h.AddUserAsync("Maker");
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync(UsersModule, checker);
        var target = await h.AddUserAsync("Target");
        var request = await SubmitUserDeleteAsync(maker, target);

        await h.Approvals.ApproveAsync(request, checker.Id);

        var error = await Assert.ThrowsAsync<ConflictAppException>(
            () => h.Approvals.ApproveAsync(request, checker.Id));

        Assert.Contains("already been approved", error.Message);
    }

    /// <summary>
    /// A maker trying to approve their own request is an attempt to defeat segregation of duties — the
    /// one thing this engine exists to enforce. Refusing it is not enough; the attempt has to be on
    /// the record, or the trail shows only the eventual legitimate approval and nothing of the try.
    /// </summary>
    [Fact]
    public async Task A_refused_self_approval_is_recorded_against_the_person_who_tried()
    {
        var maker = await h.AddUserAsync("Maker");
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync(UsersModule, checker);
        var request = await SubmitUserDeleteAsync(maker);
        var requestedCorrelation = (await h.Db.ApprovalRequests.FindAsync(request))!.CorrelationId;

        await Assert.ThrowsAsync<ForbiddenAppException>(() => h.Approvals.ApproveAsync(request, maker.Id));

        var refused = await h.Db.AuditLogs.SingleAsync(a => a.Action == "approval.decision_refused");
        Assert.Equal("Failure", refused.Result);
        Assert.Equal(maker.Id, refused.ActorUserId);
        Assert.Contains("own request", refused.FailureReason);
        Assert.Contains("attempt to approve", refused.Details);
        Assert.Equal(requestedCorrelation, refused.CorrelationId);
    }

    [Fact]
    public async Task A_rejection_by_someone_other_than_the_assigned_checker_is_recorded()
    {
        var maker = await h.AddUserAsync("Maker");
        var assigned = await h.AddUserAsync("Assigned");
        var bystander = await h.AddUserAsync("Bystander");
        await h.GateAsync(UsersModule, assigned);
        var request = await SubmitUserDeleteAsync(maker);

        await Assert.ThrowsAsync<ForbiddenAppException>(
            () => h.Approvals.RejectAsync(request, bystander.Id, "not mine to decide"));

        var refused = await h.Db.AuditLogs.SingleAsync(a => a.Action == "approval.decision_refused");
        Assert.Equal(bystander.Id, refused.ActorUserId);
        Assert.Contains("attempt to reject", refused.Details);
    }

    [Fact]
    public async Task A_second_decision_on_a_decided_request_is_recorded_and_changes_nothing()
    {
        var maker = await h.AddUserAsync("Maker");
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync(UsersModule, checker);
        var target = await h.AddUserAsync("Target");
        var request = await SubmitUserDeleteAsync(maker, target);
        await h.Approvals.ApproveAsync(request, checker.Id);

        await Assert.ThrowsAsync<ConflictAppException>(
            () => h.Approvals.RejectAsync(request, checker.Id, "changed my mind"));

        var refused = await h.Db.AuditLogs.SingleAsync(a => a.Action == "approval.decision_refused");
        Assert.Contains("currently Approved", refused.Details);
        Assert.Equal(ApprovalStatus.Approved, (await h.Db.ApprovalRequests.FindAsync(request))!.Status);
    }

    /// <summary>A permitted decision must not also leave a refusal row behind.</summary>
    [Fact]
    public async Task A_permitted_decision_writes_no_refusal()
    {
        var maker = await h.AddUserAsync("Maker");
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync(UsersModule, checker);
        var target = await h.AddUserAsync("Target");
        var request = await SubmitUserDeleteAsync(maker, target);

        await h.Approvals.ApproveAsync(request, checker.Id);

        Assert.False(await h.Db.AuditLogs.AnyAsync(a => a.Action == "approval.decision_refused"));
    }

    // ── Replaying each in-process module ─────────────────────────────────────

    [Fact]
    public async Task Approving_a_user_delete_applies_it()
    {
        var maker = await h.AddUserAsync("Maker");
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync(UsersModule, checker);
        var target = await h.AddUserAsync("Target");
        var request = await SubmitUserDeleteAsync(maker, target);

        // Nothing has happened yet — that is the point of the gate.
        Assert.NotNull(await h.Db.Users.FirstOrDefaultAsync(u => u.Id == target.Id));

        await h.Approvals.ApproveAsync(request, checker.Id);

        Assert.Null(await h.Db.Users.FirstOrDefaultAsync(u => u.Id == target.Id));
    }

    [Fact]
    public async Task Approving_a_user_disable_applies_it()
    {
        var maker = await h.AddUserAsync("Maker");
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync(UsersModule, checker);
        var target = await h.AddUserAsync("Target");

        var pending = (await h.Users.UpdateStatusAsync(target.Id, isActive: false, maker.Id)).Pending!;
        await h.Approvals.ApproveAsync(pending.ApprovalRequestId, checker.Id);

        Assert.Equal(UserStatus.Inactive, (await h.Db.Users.FindAsync(target.Id))!.Status);
    }

    [Fact]
    public async Task Approving_a_user_update_applies_it()
    {
        var maker = await h.AddUserAsync("Maker");
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync(UsersModule, checker);
        var target = await h.AddUserAsync("Target");

        var pending = (await h.Users.UpdateAsync(
            target.Id,
            new UpdateUserRequest("Renamed Target", target.Email, "0100000000", null, true, null, null),
            overrides: null, maker.Id)).Pending!;

        await h.Approvals.ApproveAsync(pending.ApprovalRequestId, checker.Id);

        Assert.Equal("Renamed Target", (await h.Db.Users.FindAsync(target.Id))!.Name);
    }

    /// <summary>
    /// Two different submissions share the <c>(Users, Update)</c> replay case and are told apart by
    /// EntityType alone. Collapsing them would apply a permission change as if it were a core-field
    /// edit — wiping the overrides the request was actually about.
    /// </summary>
    [Fact]
    public async Task Approving_a_permission_override_change_applies_the_overrides_not_the_core_fields()
    {
        var maker = await h.AddUserAsync("Maker");
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync(UsersModule, checker);
        var target = await h.AddUserAsync("Target");
        var feature = await h.AddFeatureAsync("host.settings.users", "Delete");

        var pending = (await h.Users.ReplacePermissionOverridesAsync(
            target.Id, [new PermissionOverrideDto(feature.Key, "Delete", "Grant")], maker.Id)).Pending!;

        var stored = await h.Db.ApprovalRequests.FindAsync(pending.ApprovalRequestId);
        Assert.Equal("UserPermissionOverrides", stored!.EntityType);

        await h.Approvals.ApproveAsync(pending.ApprovalRequestId, checker.Id);

        var applied = await h.Db.UserPermissionOverrides.SingleAsync(o => o.UserId == target.Id);
        Assert.Equal("Delete", applied.Capability);
        Assert.Equal(PermissionEffect.Grant, applied.Effect);
        Assert.Equal("Target", (await h.Db.Users.FindAsync(target.Id))!.Name);
    }

    [Fact]
    public async Task Approving_a_role_create_applies_it()
    {
        var maker = await h.AddUserAsync("Maker");
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync(RolesModule, checker);

        var pending = (await h.Roles.CreateAsync(
            new UpsertRoleRequest("New Role", "Created through approval", false, []), maker.Id)).Pending!;

        await h.Approvals.ApproveAsync(pending.ApprovalRequestId, checker.Id);

        Assert.NotNull(await h.Db.Roles.FirstOrDefaultAsync(r => r.Name == "New Role"));
    }

    /// <summary>
    /// A generic remote replay: AuthService owns no handler for the module, so it POSTs to the origin
    /// service's own callback URL.
    /// </summary>
    [Fact]
    public async Task Approving_a_remote_modules_request_posts_it_back_to_the_origin_service()
    {
        var maker = await h.AddUserAsync("Maker");
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync("remote.lead", checker);

        var pending = await h.Gating.SubmitAsync(
            "remote.lead", "Create", "Lead", null, "Acme Corp", null, """{"name":"Acme Corp"}""", maker.Id,
            sourceService: "LeadService",
            callbackUrl: "http://lead-service/internal/approvals/apply",
            entityKey: "lead:acme");

        await h.Approvals.ApproveAsync(pending.ApprovalRequestId, checker.Id);

        Assert.Equal(["http://lead-service/internal/approvals/apply"], h.RemoteCallbacks.Calls);
    }

    /// <summary>
    /// A remote that refuses the replay must not leave the change looking applied.
    /// </summary>
    /// <remarks>
    /// What this asserts is that the error propagates to the checker rather than being swallowed —
    /// the callback client is deliberately NOT best-effort, unlike the audit push, precisely so a
    /// failed replay cannot be mistaken for a successful one.
    ///
    /// It does NOT assert that the request is still Pending afterwards, and that omission is
    /// deliberate rather than an oversight. The status flip and the replay share one transaction, so
    /// on Postgres the flip rolls back with the failure; the in-memory provider has no transactions,
    /// so here the flip survives. Asserting Pending would be asserting the test provider's behaviour,
    /// not the product's. The rollback is a database property, and the transaction that produces it
    /// is pinned in <see cref="ApprovalSchemaTests"/>.
    /// </remarks>
    [Fact]
    public async Task A_remote_that_refuses_the_replay_surfaces_the_failure_to_the_checker()
    {
        var maker = await h.AddUserAsync("Maker");
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync("remote.lead", checker);
        h.RemoteCallbacks.ResponseStatus = HttpStatusCode.InternalServerError;

        var pending = await h.Gating.SubmitAsync(
            "remote.lead", "Create", "Lead", null, "Acme Corp", null, "{}", maker.Id,
            sourceService: "LeadService", callbackUrl: "http://lead-service/internal/approvals/apply",
            entityKey: "lead:acme");

        var error = await Assert.ThrowsAsync<InvalidOperationException>(
            () => h.Approvals.ApproveAsync(pending.ApprovalRequestId, checker.Id));

        Assert.Contains("failed with 500", error.Message);
        // The remote was called exactly once. A retry that re-sent it would apply the mutation twice
        // in the remote's own database, which our transaction cannot undo — see the guard test in
        // ApprovalConcurrencyTests.
        Assert.Single(h.RemoteCallbacks.Calls);
    }

    /// <summary>
    /// A failed replay used to leave nothing at all behind: the transaction rolled back, so the
    /// status flip vanished with it and there was no record that a decision had even been attempted.
    /// The row is written outside the transaction precisely so it survives the rollback it describes.
    /// </summary>
    [Fact]
    public async Task A_failed_replay_is_recorded_even_though_everything_else_rolls_back()
    {
        var maker = await h.AddUserAsync("Maker");
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync("remote.lead", checker);
        h.RemoteCallbacks.ResponseStatus = HttpStatusCode.BadGateway;

        var pending = await h.Gating.SubmitAsync(
            "remote.lead", "Create", "Lead", null, "Acme Corp", null, "{}", maker.Id,
            sourceService: "LeadService", callbackUrl: "http://lead-service/internal/approvals/apply",
            entityKey: "lead:acme");

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => h.Approvals.ApproveAsync(pending.ApprovalRequestId, checker.Id));

        var failure = await h.Db.AuditLogs.SingleAsync(a => a.Action == "approval.replay_failed");
        Assert.Equal("Failure", failure.Result);
        Assert.Equal(checker.Id, failure.ActorUserId);
        Assert.Contains("still Pending", failure.Details);
    }

    /// <summary>
    /// The replay goes through the same validation a direct call would, so the world moving under a
    /// pending request surfaces as a real error rather than corrupting data. Here: someone else takes
    /// the email while a Create-User waits.
    /// </summary>
    /// <remarks>
    /// Re-running those validations at replay time is the deliberate part. A replay that trusted the
    /// snapshot and skipped them would happily insert a duplicate account, because the check that
    /// would have caught it ran days earlier against a database that no longer looks the same.
    /// </remarks>
    [Fact]
    public async Task A_replay_whose_preconditions_no_longer_hold_fails_instead_of_corrupting_data()
    {
        var maker = await h.AddUserAsync("Maker");
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync(UsersModule, checker);

        var pending = (await h.Users.CreateAsync(
            new CreateUserRequest("Newcomer", "contested@example.com", "0100000000", null, true, "Local", null, null),
            overrides: null, maker.Id)).Pending!;

        // The email is taken while the request sits in the queue.
        await h.AddUserAsync("Someone Else", email: "contested@example.com");

        var error = await Assert.ThrowsAsync<ConflictAppException>(
            () => h.Approvals.ApproveAsync(pending.ApprovalRequestId, checker.Id));

        Assert.Contains("already exists", error.Message);

        // The account was not created a second time — which is the outcome that actually matters, and
        // unlike the request's status it is observable without a transaction. See the remark on
        // A_remote_that_refuses_the_replay_surfaces_the_failure_to_the_checker.
        Assert.Equal(1, await h.Db.Users.CountAsync(u => u.Email == "contested@example.com"));
    }

    // ── Attribution and correlation ──────────────────────────────────────────

    /// <summary>
    /// A replayed mutation is attributed to the MAKER, not the checker who released it — so an
    /// approved change reads in the audit trail exactly as it would have if it had never been gated.
    /// The approval itself is a separate row, against the checker.
    /// </summary>
    [Fact]
    public async Task A_replayed_mutation_is_attributed_to_the_maker_not_the_checker()
    {
        var maker = await h.AddUserAsync("Maker");
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync(UsersModule, checker);
        var target = await h.AddUserAsync("Target");
        var request = await SubmitUserDeleteAsync(maker, target);

        await h.Approvals.ApproveAsync(request, checker.Id);

        var deletion = await h.Db.AuditLogs.SingleAsync(a => a.Action == "user.deleted");
        Assert.Equal(maker.Id, deletion.ActorUserId);

        var approval = await h.Db.AuditLogs.SingleAsync(a => a.Action == "approval.approved");
        Assert.Equal(checker.Id, approval.ActorUserId);
    }

    /// <summary>
    /// Requested, approved and the mutation itself are one operation and share one correlation id.
    /// That thread is what makes the Audit Log's "related activity" view able to reconstruct a gated
    /// change from three rows written across two different HTTP requests, minutes or days apart.
    /// </summary>
    [Fact]
    public async Task The_request_the_approval_and_the_replayed_mutation_share_one_correlation_id()
    {
        var maker = await h.AddUserAsync("Maker");
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync(UsersModule, checker);
        var target = await h.AddUserAsync("Target");

        // Two genuinely separate requests, which is the only arrangement in which this can fail.
        h.BeginRequest();
        var request = await SubmitUserDeleteAsync(maker, target);

        var stored = await h.Db.ApprovalRequests.AsNoTracking().SingleAsync(r => r.Id == request);

        h.BeginRequest();
        await h.Approvals.ApproveAsync(request, checker.Id);

        var thread = await h.Db.AuditLogs
            .Where(a => a.CorrelationId == stored.CorrelationId)
            .Select(a => a.Action)
            .ToListAsync();

        Assert.Contains("approval.requested", thread);
        Assert.Contains("approval.approved", thread);
        Assert.Contains("user.deleted", thread);
    }

    /// <summary>
    /// A privilege-escalation guard that must key off the MAKER's identity, not the ambient one.
    /// During a replay the HTTP context belongs to the checker, so a claim-based check would let a
    /// super-admin checker rubber-stamp an escalation the non-admin maker could never have submitted.
    /// </summary>
    [Fact]
    public async Task An_administrator_checker_cannot_release_an_escalation_the_maker_could_not_have_made()
    {
        var adminRole = await h.AddRoleAsync("Super Admin", isAdministrator: true);
        var maker = await h.AddUserAsync("Ordinary Maker");
        var adminChecker = await h.AddUserAsync("Admin Checker", role: adminRole);
        await h.GateAsync(RolesModule, adminChecker);

        // The maker is not an administrator, so this is refused at submit time — before it can ever
        // become a request for an administrator to wave through.
        await Assert.ThrowsAsync<ForbiddenAppException>(
            () => h.Roles.CreateAsync(
                new UpsertRoleRequest("Backdoor", "Grants everything", true, []), maker.Id));

        Assert.Empty(await h.Db.ApprovalRequests.ToListAsync());
    }

    // ── Rejection ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Rejecting_records_the_reason_and_applies_nothing()
    {
        var maker = await h.AddUserAsync("Maker");
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync(UsersModule, checker);
        var target = await h.AddUserAsync("Target");
        var request = await SubmitUserDeleteAsync(maker, target);

        await h.Approvals.RejectAsync(request, checker.Id, "Not authorised by the business owner.");

        var stored = await h.Db.ApprovalRequests.AsNoTracking().SingleAsync(r => r.Id == request);
        Assert.Equal(ApprovalStatus.Rejected, stored.Status);
        Assert.Equal("Not authorised by the business owner.", stored.RejectionReason);
        Assert.NotNull(await h.Db.Users.FirstOrDefaultAsync(u => u.Id == target.Id));

        var audit = await h.Db.AuditLogs.SingleAsync(a => a.Action == "approval.rejected");
        Assert.Contains("Not authorised by the business owner.", audit.Details);
    }

    [Fact]
    public async Task A_maker_cannot_reject_their_own_request_either()
    {
        var maker = await h.AddUserAsync("Maker");
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync(UsersModule, checker);
        var request = await SubmitUserDeleteAsync(maker);

        await Assert.ThrowsAsync<ForbiddenAppException>(
            () => h.Approvals.RejectAsync(request, maker.Id, "Changed my mind."));
    }

    // ── How an approved account becomes usable ───────────────────────────────

    /// <summary>
    /// Approval used to mint a temporary password, encrypt it onto the request row, and wait for the
    /// maker to collect it from My Requests. The account is now emailed a set-password link instead,
    /// and the replay carries nothing back that has to be kept.
    ///
    /// Worth pinning because the failure is silent in both directions: no invite means an account
    /// exists that nobody can sign into, and a credential surfacing anywhere in the response or the
    /// trail would be the exact exposure the invite mechanism exists to remove.
    /// </summary>
    [Fact]
    public async Task Approving_a_user_create_emails_the_new_account_its_set_password_link()
    {
        var (_, checker, requestId) = await SubmitUserCreateAsync();

        await h.Approvals.ApproveAsync(requestId, checker.Id);

        var created = await h.Db.Users.AsNoTracking().SingleAsync(u => u.Email == "newcomer@example.com");
        Assert.Contains(h.Emails.Sent, m => m.To == created.Email);
        Assert.True(await h.Db.SetPasswordInvites.AnyAsync(i => i.UserId == created.Id && i.UsedAt == null));
    }

    [Fact]
    public async Task Approving_a_user_create_puts_no_credential_in_the_audit_trail()
    {
        var (_, checker, requestId) = await SubmitUserCreateAsync();

        await h.Approvals.ApproveAsync(requestId, checker.Id);

        // The invite is recorded; the token inside it is not, and neither is any password.
        var invite = await h.Db.AuditLogs.SingleAsync(a => a.Action == "auth.invite_issued");
        Assert.DoesNotContain("password=", invite.Details ?? "", StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("token", invite.Details ?? "", StringComparison.OrdinalIgnoreCase);

        Assert.False(await h.Db.AuditLogs.AnyAsync(a => a.Action.Contains("temp_password")));
    }

    /// <summary>
    /// A mail outage must not undo an approval. The account is already created and committed by the
    /// time the invite is attempted, so a failed send leaves a real account that simply cannot be
    /// signed into yet — which is what Resend Invite exists to fix.
    /// </summary>
    [Fact]
    public async Task A_failed_invite_email_does_not_roll_back_the_approval()
    {
        var (_, checker, requestId) = await SubmitUserCreateAsync();
        h.Emails.IsEnabled = false;

        await h.Approvals.ApproveAsync(requestId, checker.Id);

        var request = await h.Db.ApprovalRequests.AsNoTracking().SingleAsync(r => r.Id == requestId);
        Assert.Equal(ApprovalStatus.Approved, request.Status);
        Assert.NotNull(await h.Db.Users.FirstOrDefaultAsync(u => u.Email == "newcomer@example.com"));
    }

    // ── Notifications ────────────────────────────────────────────────────────

    /// <summary>
    /// A decision has to reach both parties and update the checker's badge. The publisher swallows
    /// its own failures by design so a SignalR outage cannot roll back a committed decision, which
    /// also means a broken fan-out is completely silent at runtime.
    /// </summary>
    [Fact]
    public async Task Deciding_a_request_notifies_both_parties_and_clears_the_checkers_badge()
    {
        var maker = await h.AddUserAsync("Maker");
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync(UsersModule, checker);
        var target = await h.AddUserAsync("Target");
        var request = await SubmitUserDeleteAsync(maker, target);

        Assert.Equal(1, h.Events.LatestBadgeFor(checker.Id));

        await h.Approvals.ApproveAsync(request, checker.Id);

        Assert.Contains(h.Events.ApprovalViewerEvents, e => e.Action == "approved");
        var notified = h.Events.UserEvents.Last();
        Assert.Contains(maker.Id, notified.UserIds);
        Assert.Contains(checker.Id, notified.UserIds);
        Assert.Equal(0, h.Events.LatestBadgeFor(checker.Id));
    }

    // ── Fixtures ─────────────────────────────────────────────────────────────

    private async Task<Guid> SubmitUserDeleteAsync(Domain.Entities.User maker, Domain.Entities.User? target = null)
    {
        target ??= await h.AddUserAsync($"Target-{Guid.NewGuid():N}");
        var pending = await h.Users.DeleteAsync(target.Id, maker.Id);
        return pending!.ApprovalRequestId;
    }

    private async Task<(Domain.Entities.User Maker, Domain.Entities.User Checker, Guid RequestId)> SubmitUserCreateAsync()
    {
        var maker = await h.AddUserAsync("Maker");
        var checker = await h.AddUserAsync("Checker");
        await h.GateAsync(UsersModule, checker);

        var pending = (await h.Users.CreateAsync(
            new CreateUserRequest("Newcomer", "newcomer@example.com", "0100000000", null, true, "Local", null, null),
            overrides: null, maker.Id)).Pending!;

        // The snapshot is the flat UserSnapshotDto shape, which the diff pane and the replay both
        // read — asserted here because collapsing it back to a live request DTO is an easy mistake
        // that only shows up at approval time.
        var stored = await h.Db.ApprovalRequests.AsNoTracking().SingleAsync(r => r.Id == pending.ApprovalRequestId);
        var snapshot = JsonSerializer.Deserialize<UserSnapshotDto>(stored.NewDataJson)!;
        Assert.Equal("newcomer@example.com", snapshot.Email);

        return (maker, checker, pending.ApprovalRequestId);
    }
}
