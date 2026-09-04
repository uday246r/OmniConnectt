using System.Text.Json;
using AuthService.Application.DTOs;
using AuthService.Application.Events;
using AuthService.Application.Exceptions;
using AuthService.Domain.Entities;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;

namespace AuthService.Application.Services;

/// <summary>
/// The checker-side half of the approval engine — listing/reading requests, and deciding them.
///
/// Depends on UserAppService/RoleAppService (to replay an approved mutation through the exact same
/// validated method a direct call would have used), which is why this is a separate service from
/// ApprovalGatingService: those two app services depend on the gating service, not on this one, so
/// there is no dependency cycle.
/// </summary>
public class ApprovalAppService(
    AuthDbContext db, AuditLogAppService auditLog, UserAppService userAppService, RoleAppService roleAppService,
    RemoteApprovalCallbackClient callbackClient, SecretProtector secretProtector, IPlatformEventPublisher events)
{
    private const string ServiceName = "AuthService";

    public async Task<PagedResult<ApprovalRequestListItemDto>> ListAsync(
        int page, int pageSize, string? module, string? status, Guid? makerId, Guid? checkerId,
        DateTimeOffset? from, DateTimeOffset? to, CancellationToken ct = default)
    {
        var query = BuildFilteredQuery(module, status, makerId, checkerId, from, to);

        var total = await query.CountAsync(ct);
        var items = await query
            .OrderByDescending(r => r.RequestedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(r => ToListItemDto(r))
            .ToListAsync(ct);

        return new PagedResult<ApprovalRequestListItemDto>(items, total, page, pageSize);
    }

    public async Task<ApprovalRequestDetailDto> GetAsync(Guid id, CancellationToken ct = default)
    {
        var request = await db.ApprovalRequests.AsNoTracking().FirstOrDefaultAsync(r => r.Id == id, ct) ?? throw NotFound(id);
        return ToDetailDto(request);
    }

    /// <summary>Real DB aggregates — never client-derived from a partial page of rows.</summary>
    public async Task<ApprovalSummaryDto> SummaryAsync(Guid currentUserId, CancellationToken ct = default)
    {
        // DateTimeOffset.UtcNow.Date returns a plain DateTime (Kind=Unspecified) — assigning that
        // straight to a DateTimeOffset silently reinterprets it in the server process's LOCAL offset
        // (e.g. +05:30), not UTC. Npgsql then rejects it outright: "timestamp with time zone" only
        // accepts offset 0. Constructing explicitly with TimeSpan.Zero is what actually stays UTC.
        var todayStart = new DateTimeOffset(DateTimeOffset.UtcNow.Date, TimeSpan.Zero);

        var pendingTotal = await db.ApprovalRequests.CountAsync(r => r.Status == ApprovalStatus.Pending, ct);
        var approvedToday = await db.ApprovalRequests.CountAsync(
            r => r.Status == ApprovalStatus.Approved && r.DecidedAt >= todayStart, ct);
        var rejectedToday = await db.ApprovalRequests.CountAsync(
            r => r.Status == ApprovalStatus.Rejected && r.DecidedAt >= todayStart, ct);
        var assignedToMePending = await db.ApprovalRequests.CountAsync(
            r => r.Status == ApprovalStatus.Pending && r.CheckerId == currentUserId, ct);

        return new ApprovalSummaryDto(pendingTotal, approvedToday, rejectedToday, assignedToMePending);
    }

    public async Task<ApprovalRequestDetailDto> ApproveAsync(Guid id, Guid checkerUserId, bool isAdministrator = false, CancellationToken ct = default)
    {
        var request = await db.ApprovalRequests.FirstOrDefaultAsync(r => r.Id == id, ct) ?? throw NotFound(id);
        EnsureDecidable(request, checkerUserId, isAdministrator);

        // Refuse BEFORE the replay, not after. Approving a Create-User generates a temporary
        // password that exists only in memory; if it cannot be encrypted for the maker to collect,
        // the account would be created with a password nobody could ever learn. Failing up front
        // leaves the request Pending and nothing applied.
        if (request is { Module: ApprovalModuleKeys.Users, Action: ApprovalActionKeys.Create } && !secretProtector.IsConfigured)
        {
            throw new ConflictAppException(
                "This server cannot store the temporary password a new account requires " +
                "(Security__TempPasswordKey is not configured). Ask an administrator to configure it, then approve again.");
        }

        /*
         * CLAIM FIRST, THEN REPLAY — both inside one transaction.
         *
         * The order matters and used to be the other way round. Replaying first meant the inner
         * service's own SaveChangesAsync COMMITTED the mutation before this method had recorded any
         * decision, so a failure in the gap left the user created/deleted while the request still read
         * Pending — and therefore still approvable, applying it a second time.
         *
         * Flipping the status first turns the decision into the claim: the UPDATE carries the xmin
         * concurrency token (see AuthDbContext), so of two simultaneous approvals exactly one succeeds
         * and the other matches zero rows. The transaction then makes the pair atomic in the other
         * direction too — if the replay throws, the status flip rolls back with it and the request is
         * genuinely still Pending rather than half-decided.
         *
         * The replay itself runs through the SAME validated method a direct call would have used, so
         * "the email was taken by someone else while this was pending" surfaces as a real error to the
         * checker instead of silently corrupting data. actingUserId is the MAKER, not the checker, so
         * the resulting "user.created"/"role.updated" audit row is attributed exactly as an ungated
         * mutation would be.
         */
        /*
         * The transaction below MUST run inside an execution strategy.
         *
         * AuthService enables EnableRetryOnFailure (Azure SQL auto-pause returns a transient 40613 —
         * see Program.cs), and EF refuses a user-initiated transaction under a retrying strategy
         * unless the whole unit is retriable: without this wrapper the very first Approve click
         * throws "The configured execution strategy 'SqlServerRetryingExecutionStrategy' does not
         * support user-initiated transactions."
         *
         * The guard is the subtle part. Everything inside the transaction rolls back on a transient
         * failure and is safe to repeat — EXCEPT the remote replay, which is an HTTP POST to another
         * service's own database and is therefore not covered by our rollback. Re-running the
         * delegate must not re-send it, or a retried approval would apply a remote Create twice. The
         * guard is declared OUTSIDE the delegate so it survives across retries; in-process replays
         * are deliberately NOT guarded, because those really are rolled back and really must re-run.
         */
        var remoteReplay = new RemoteReplayGuard();
        var issuedTempPassword = await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);

            request.Status = ApprovalStatus.Approved;
            request.DecidedAt = DateTimeOffset.UtcNow;

            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateConcurrencyException)
            {
                // Someone else decided this request between our read and our write. Their outcome stands.
                throw new ConflictAppException(
                    "This request was just decided by someone else. Refresh to see its current status.");
            }

            // The only thing a replay can produce that is otherwise unrecoverable afterwards is a
            // Create-User's temporary password (everything else is readable back from the DB, or is a
            // password hash which is one-way by design) — see ReplayAsync's own doc comment.
            var tempPassword = await ReplayAsync(request, remoteReplay, ct);

            if (tempPassword is not null)
            {
                request.TempPasswordCiphertext = secretProtector.Protect(tempPassword);
                await db.SaveChangesAsync(ct);
            }

            await transaction.CommitAsync(ct);
            return tempPassword;
        });

        var checkerName = await db.Users.AsNoTracking().Where(u => u.Id == checkerUserId).Select(u => u.Name).FirstOrDefaultAsync(ct);
        await auditLog.WriteAsync(
            ServiceName, checkerUserId, checkerName, "approval.approved", "ApprovalRequest", request.Id.ToString(),
            $"Approved {request.Action} on {request.Module}" + (request.EntityLabel is not null ? $" ({request.EntityLabel})" : "") + $" — requested by {request.MakerName}.",
            entityLabel: request.EntityLabel, ct: ct);

        if (issuedTempPassword is not null)
        {
            // Names WHO the password is for and WHO must collect it — never the password itself.
            // The audit log is readable by anyone holding host.system.audit-logs:View, a far wider
            // audience than the single maker the secret is meant for.
            await auditLog.WriteAsync(
                ServiceName, checkerUserId, checkerName, "user.temp_password_issued", "ApprovalRequest", request.Id.ToString(),
                $"A one-time temporary password was issued for {request.EntityLabel ?? "the new account"} and is waiting for {request.MakerName} to collect from My Requests.",
                entityLabel: request.EntityLabel, ct: ct);
        }

        var interestedUsers = new List<Guid> { request.MakerId, request.CheckerId };
        await events.PublishToApprovalViewersAsync(new PlatformEvent("approvals", "approved"), ct);
        await events.PublishToUsersAsync(interestedUsers, new PlatformEvent("approvals", "approved"), ct);
        var count = await db.ApprovalRequests.CountAsync(r => r.CheckerId == request.CheckerId && r.Status == ApprovalStatus.Pending, ct);
        await events.PublishBadgeAsync(request.CheckerId, count, ct);

        return ToDetailDto(request);
    }

    public async Task<ApprovalRequestDetailDto> RejectAsync(Guid id, Guid checkerUserId, string reason, bool isAdministrator = false, CancellationToken ct = default)
    {
        var request = await db.ApprovalRequests.FirstOrDefaultAsync(r => r.Id == id, ct) ?? throw NotFound(id);
        EnsureDecidable(request, checkerUserId, isAdministrator);

        request.Status = ApprovalStatus.Rejected;
        request.DecidedAt = DateTimeOffset.UtcNow;
        request.RejectionReason = reason;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Same race as ApproveAsync — a rejection landing after someone else already approved must
            // not silently overwrite that decision. No transaction needed here: rejecting replays
            // nothing, so this single write is already the whole operation.
            throw new ConflictAppException(
                "This request was just decided by someone else. Refresh to see its current status.");
        }

        var checkerName = await db.Users.AsNoTracking().Where(u => u.Id == checkerUserId).Select(u => u.Name).FirstOrDefaultAsync(ct);
        await auditLog.WriteAsync(
            ServiceName, checkerUserId, checkerName, "approval.rejected", "ApprovalRequest", request.Id.ToString(),
            $"Rejected {request.Action} on {request.Module}" + (request.EntityLabel is not null ? $" ({request.EntityLabel})" : "") + $" — requested by {request.MakerName}. Reason: {reason}",
            entityLabel: request.EntityLabel, ct: ct);

        var interestedUsers = new List<Guid> { request.MakerId, request.CheckerId };
        await events.PublishToApprovalViewersAsync(new PlatformEvent("approvals", "rejected"), ct);
        await events.PublishToUsersAsync(interestedUsers, new PlatformEvent("approvals", "rejected"), ct);
        var count = await db.ApprovalRequests.CountAsync(r => r.CheckerId == request.CheckerId && r.Status == ApprovalStatus.Pending, ct);
        await events.PublishBadgeAsync(request.CheckerId, count, ct);

        return ToDetailDto(request);
    }

    /// <summary>
    /// Hands the maker — and only the maker — the one-time temporary password produced when their
    /// Create-User request was approved, then destroys it.
    ///
    /// Ownership is enforced HERE, server-side, from the caller's own token-derived id; there is no
    /// permission attribute on the endpoint. Same shape as GET /api/approvals/mine: every user must
    /// be able to collect the credential for an account they themselves created, whether or not they
    /// hold Approval Center access, and makerId is never client-supplied.
    ///
    /// The secret is destroyed and COMMITTED before this method returns — deliberately before the
    /// response is written. A crash between destroy and respond loses the password (recoverable only
    /// by an administrator re-creating the account, but exposes nothing and cannot be replayed); the
    /// reverse order would let a crash between respond and destroy leave the secret retrievable a
    /// second time, defeating the entire one-time property. A credential that must be re-issued is an
    /// operational annoyance; a credential that can be served twice is a security defect.
    /// </summary>
    public async Task<RevealTempPasswordResponse> RevealTempPasswordAsync(Guid id, Guid callerUserId, CancellationToken ct = default)
    {
        var request = await db.ApprovalRequests.FirstOrDefaultAsync(r => r.Id == id, ct) ?? throw NotFound(id);

        if (request.MakerId != callerUserId)
        {
            throw new ForbiddenAppException("Only the person who submitted this request can view its temporary password.");
        }

        if (request.TempPasswordCiphertext is null)
        {
            throw request.TempPasswordRevealedAt is not null
                ? new GoneAppException("This temporary password has already been viewed once and is no longer available.")
                : new NotFoundAppException("This request has no temporary password to view.");
        }

        var plaintext = secretProtector.Unprotect(request.TempPasswordCiphertext);

        // Unrecoverable ciphertext (key rotated, column tampered with). Clear it anyway — leaving an
        // undecryptable value behind would make this row answer 404 "no password" forever while the
        // list still advertised one.
        if (plaintext is null)
        {
            request.TempPasswordCiphertext = null;
            request.TempPasswordRevealedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
            throw new GoneAppException("This temporary password can no longer be decrypted on this server and must be re-issued by an administrator.");
        }

        request.TempPasswordCiphertext = null;
        request.TempPasswordRevealedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);

        var makerName = await db.Users.AsNoTracking().Where(u => u.Id == callerUserId).Select(u => u.Name).FirstOrDefaultAsync(ct);
        await auditLog.WriteAsync(
            ServiceName, callerUserId, makerName, "user.temp_password_revealed", "ApprovalRequest", request.Id.ToString(),
            $"Collected the one-time temporary password for {request.EntityLabel ?? "a new account"}. It is no longer retrievable.",
            entityLabel: request.EntityLabel, ct: ct);

        await events.PublishToUsersAsync([callerUserId], new PlatformEvent("approvals", "temp-password-collected"), ct);

        // EntityId is null on a Create request, so the snapshot's email is the only link back to the
        // account actually created by the replay.
        var snapshot = JsonSerializer.Deserialize<UserSnapshotDto>(request.NewDataJson)!;
        var account = await db.Users.AsNoTracking()
            .Where(u => u.Email == snapshot.Email)
            .Select(u => new { u.Name, u.Email })
            .FirstOrDefaultAsync(ct);

        return new RevealTempPasswordResponse(plaintext, account?.Name ?? snapshot.Name, account?.Email ?? snapshot.Email);
    }

    /// <summary>Server-side enforcement of both confirmed rules, defense in depth even though the maker
    /// is already excluded from checker auto-selection: the request must still be Pending, and the
    /// caller must be THIS request's specific assigned checker — not just any checker of the module,
    /// and never the maker.
    ///
    /// A Super Admin (the "administrator" claim — the same identity that already bypasses every
    /// permission check and, as of the Maker-Checker bypass, the gate itself) is exempt from the
    /// assigned-checker rule ONLY. They are the platform's escalation path: a request whose assigned
    /// checker has left or is unavailable must not become permanently undecidable.
    ///
    /// The other two rules still apply to them: already-decided is a correctness rule, not an
    /// authority rule, and maker != checker is the entire point of Maker-Checker — it is defense in
    /// depth here rather than a live path, since a Super Admin whose own mutations bypass the gate
    /// entirely can no longer become a maker at all.</summary>
    private static void EnsureDecidable(ApprovalRequest request, Guid checkerUserId, bool isAdministrator)
    {
        if (request.Status != ApprovalStatus.Pending)
        {
            throw new ConflictAppException($"This request has already been {request.Status.ToLowerInvariant()}.");
        }

        if (request.MakerId == checkerUserId)
        {
            throw new ForbiddenAppException("You cannot approve or reject your own request.");
        }

        if (!isAdministrator && request.CheckerId != checkerUserId)
        {
            throw new ForbiddenAppException("Only the assigned checker can act on this request.");
        }
    }

    /// <summary>
    /// Replays the approved mutation and returns the ONE piece of state that only exists inside the
    /// replay and cannot be recovered afterwards: the temporary password generated for a newly
    /// created Local user. Every other case returns null — nothing else a replay produces is
    /// unrecoverable (the created/updated entity is readable from the database afterwards; a
    /// password hash is not reversible).
    /// </summary>
    /// <summary>
    /// Tracks whether this approval's REMOTE replay POST has already been sent, so a retry of the
    /// surrounding execution strategy cannot fire it a second time. A plain class (not a bool) so the
    /// flag is shared by reference with the retry delegate — an async lambda cannot take a `ref`.
    /// </summary>
    private sealed class RemoteReplayGuard
    {
        public bool Fired { get; set; }
    }

    private async Task<string?> ReplayAsync(ApprovalRequest request, RemoteReplayGuard remoteReplay, CancellationToken ct)
    {
        switch (request.Module, request.Action)
        {
            // NewDataJson is always the flat UserSnapshotDto shape — never a live CreateUserRequest/
            // UpdateUserRequest directly — so it's the same shape ApprovalCenterPage's diff view reads
            // for the "Requested Change" pane. Reconstruct the real request type's fields from it here.
            case (ApprovalModuleKeys.Users, ApprovalActionKeys.Create):
                var createSnapshot = JsonSerializer.Deserialize<UserSnapshotDto>(request.NewDataJson)!;
                var createUser = new CreateUserRequest(
                    createSnapshot.Name, createSnapshot.Email, createSnapshot.PhoneNumber ?? "",
                    createSnapshot.RoleId, createSnapshot.IsActive, createSnapshot.AuthProvider ?? "Local");
                var createResult = await userAppService.CreateAsync(createUser, createSnapshot.Overrides, request.MakerId, ct, bypassApproval: true);
                // Applied is always non-null here — bypassApproval:true means CreateAsync cannot take
                // the gated branch. The password itself is null for a Google account, which has no
                // local password.
                return createResult.Applied?.TemporaryPassword;

            case (ApprovalModuleKeys.Users, ApprovalActionKeys.Update):
                // Two possible origins for the same (Module, Action) pair, told apart by EntityType: a
                // bundled core-field-plus-overrides edit from UserFormLayer ("User"), or a submission
                // from the standalone permission-overrides endpoint ("UserPermissionOverrides") — see
                // ReplacePermissionOverridesAsync's own doc comment. Both store the same flat
                // UserSnapshotDto shape; the overrides-only origin just has identical core fields on
                // both the old and new side.
                if (request.EntityType == "UserPermissionOverrides")
                {
                    var overridesSnapshot = JsonSerializer.Deserialize<UserSnapshotDto>(request.NewDataJson)!;
                    // Overrides is always non-null here — ReplacePermissionOverridesAsync's own
                    // parameter is required, never omitted, so this snapshot always carries a real list.
                    await userAppService.ApplyOverridesAsync(Guid.Parse(request.EntityId!), overridesSnapshot.Overrides ?? [], request.MakerId, ct);
                }
                else
                {
                    var updateSnapshot = JsonSerializer.Deserialize<UserSnapshotDto>(request.NewDataJson)!;
                    var updateUser = new UpdateUserRequest(
                        updateSnapshot.Name, updateSnapshot.Email, updateSnapshot.PhoneNumber ?? "",
                        updateSnapshot.RoleId, updateSnapshot.IsActive);
                    await userAppService.UpdateAsync(Guid.Parse(request.EntityId!), updateUser, updateSnapshot.Overrides, request.MakerId, ct, bypassApproval: true);
                }
                break;

            case (ApprovalModuleKeys.Users, ApprovalActionKeys.Enable):
                await userAppService.UpdateStatusAsync(Guid.Parse(request.EntityId!), true, request.MakerId, ct, bypassApproval: true);
                break;

            case (ApprovalModuleKeys.Users, ApprovalActionKeys.Disable):
                await userAppService.UpdateStatusAsync(Guid.Parse(request.EntityId!), false, request.MakerId, ct, bypassApproval: true);
                break;

            case (ApprovalModuleKeys.Users, ApprovalActionKeys.Delete):
                await userAppService.DeleteAsync(Guid.Parse(request.EntityId!), request.MakerId, ct, bypassApproval: true);
                break;

            case (ApprovalModuleKeys.Roles, ApprovalActionKeys.Create):
                var createRole = JsonSerializer.Deserialize<UpsertRoleRequest>(request.NewDataJson)!;
                await roleAppService.CreateAsync(createRole, request.MakerId, ct, bypassApproval: true);
                break;

            case (ApprovalModuleKeys.Roles, ApprovalActionKeys.Update):
                var updateRole = JsonSerializer.Deserialize<UpsertRoleRequest>(request.NewDataJson)!;
                await roleAppService.UpdateAsync(Guid.Parse(request.EntityId!), updateRole, request.MakerId, ct, bypassApproval: true);
                break;

            case (ApprovalModuleKeys.Roles, ApprovalActionKeys.Delete):
                await roleAppService.DeleteAsync(Guid.Parse(request.EntityId!), request.MakerId, ct, bypassApproval: true);
                break;

            // Every module AuthService doesn't own in-process (i.e. every remote-registered module —
            // this switch only ever grows for modules AuthService itself replays) is replayed generically
            // by POSTing to request.CallbackUrl, the ORIGIN service's own internal/approvals/apply
            // endpoint, X-Internal-Api-Key protected exactly like InternalApprovalsController's inbound
            // side. A non-2xx (or a missing CallbackUrl, which should never happen for a real remote
            // submission) throws here, same as an in-process replay failure: the request stays Pending.
            default:
                if (string.IsNullOrWhiteSpace(request.CallbackUrl))
                {
                    throw new InvalidOperationException($"No replay handler for {request.Module}/{request.Action}.");
                }

                // Already sent on an earlier attempt of the retriable unit. The remote applied it to
                // its OWN database, which our transaction cannot roll back, so re-sending would
                // duplicate the mutation rather than repeat a no-op.
                if (remoteReplay.Fired)
                {
                    break;
                }

                await callbackClient.ApplyAsync(
                    request.CallbackUrl,
                    new ApplyApprovedMutationRequest(
                        request.Module, request.Action, request.EntityType, request.EntityId, request.NewDataJson,
                        request.MakerId, request.MakerName, request.CorrelationId),
                    ct);
                remoteReplay.Fired = true;
                break;
        }

        return null;
    }

    private IQueryable<ApprovalRequest> BuildFilteredQuery(
        string? module, string? status, Guid? makerId, Guid? checkerId, DateTimeOffset? from, DateTimeOffset? to)
    {
        var query = db.ApprovalRequests.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(module)) query = query.Where(r => r.Module == module);
        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(r => r.Status == status);
        if (makerId is not null) query = query.Where(r => r.MakerId == makerId);
        if (checkerId is not null) query = query.Where(r => r.CheckerId == checkerId);
        if (from is not null) query = query.Where(r => r.RequestedAt >= from);
        if (to is not null) query = query.Where(r => r.RequestedAt <= to);

        return query;
    }

    private static ApprovalRequestListItemDto ToListItemDto(ApprovalRequest r) => new(
        r.Id, r.Module, r.Action, r.EntityType, r.EntityLabel, r.Status,
        r.MakerId, r.MakerName, r.CheckerId, r.CheckerName, r.RequestedAt, r.DecidedAt, r.RejectionReason,
        r.TempPasswordCiphertext is not null);

    private static ApprovalRequestDetailDto ToDetailDto(ApprovalRequest r) => new(
        r.Id, r.Module, r.Action, r.EntityType, r.EntityId, r.EntityLabel, r.OldDataJson, r.NewDataJson,
        r.Status, r.MakerId, r.MakerName, r.CheckerId, r.CheckerName, r.RequestedAt, r.DecidedAt, r.RejectionReason);

    private static NotFoundAppException NotFound(Guid id) => new($"Approval request '{id}' was not found.");
}
