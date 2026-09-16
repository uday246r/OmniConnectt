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
    RemoteAppAppService remoteAppService, RemoteApprovalCallbackClient callbackClient,
    SecretProtector secretProtector, IPlatformEventPublisher events)
{
    private const string ServiceName = "AuthService";

    public async Task<PagedResult<ApprovalRequestListItemDto>> ListAsync(
        int page, int pageSize, ApprovalFilter filter, CancellationToken ct = default)
    {
        var query = BuildFilteredQuery(filter);

        var total = await query.CountAsync(ct);
        var items = await Order(query, filter)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(r => ToListItemDto(r))
            .ToListAsync(ct);

        return new PagedResult<ApprovalRequestListItemDto>(items, total, page, pageSize);
    }

    /// <summary>
    /// The distinct modules, actions, makers and checkers present under <paramref name="filter"/>.
    /// </summary>
    /// <remarks>
    /// These dropdowns were built from the 200 rows the page had fetched, so they could only ever
    /// offer what happened to be loaded. Makers and checkers are bounded by the user base, so a
    /// DISTINCT over them is cheap; the cap is a guard, not an expectation.
    /// </remarks>
    public async Task<ApprovalFacetsDto> FacetsAsync(ApprovalFilter filter, CancellationToken ct = default)
    {
        const int maxOptions = 200;
        var query = BuildFilteredQuery(filter);

        var modules = await query.Select(r => r.Module).Distinct().OrderBy(v => v).Take(maxOptions).ToListAsync(ct);
        var actions = await query.Select(r => r.Action).Distinct().OrderBy(v => v).Take(maxOptions).ToListAsync(ct);
        var makers = await query.Where(r => r.MakerName != null).Select(r => r.MakerName!)
            .Distinct().OrderBy(v => v).Take(maxOptions).ToListAsync(ct);
        var checkers = await query.Where(r => r.CheckerName != null).Select(r => r.CheckerName!)
            .Distinct().OrderBy(v => v).Take(maxOptions).ToListAsync(ct);

        return new ApprovalFacetsDto(modules, actions, makers, checkers);
    }

    private static IQueryable<ApprovalRequest> Order(IQueryable<ApprovalRequest> query, ApprovalFilter filter) =>
        string.Equals(filter.SortBy, "decided", StringComparison.OrdinalIgnoreCase)
            ? query.OrderByDescending(r => r.DecidedAt ?? r.RequestedAt).ThenByDescending(r => r.RequestedAt)
            : query.OrderByDescending(r => r.RequestedAt);

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
        await EnsureDecidableAsync(request, checkerUserId, isAdministrator, "approve", ct);

        // Every audit row this decision produces — including the replayed mutation several call
        // frames down inside UserAppService/RoleAppService — should read as part of the SAME
        // operation the original "approval.requested" belongs to, not as belonging to this new
        // request. See AuditLogAppService.SeedCorrelationId's own doc comment for how.
        if (!string.IsNullOrWhiteSpace(request.CorrelationId))
        {
            auditLog.SeedCorrelationId(request.CorrelationId);
        }

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
        string? issuedTempPassword;
        try
        {
            issuedTempPassword = await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
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
        }
        catch (Exception ex) when (ex is not ConflictAppException)
        {
            /*
             * The replay failed, so the whole unit rolled back — including the status flip — and the
             * request is genuinely still Pending. That rollback is the correct behaviour and it is
             * also what made this case invisible: nothing was written, so nothing could be written
             * ABOUT it either. The checker saw an error, the request sat unchanged, and the trail had
             * no record that a decision had even been attempted.
             *
             * Recorded outside the transaction, which is the point — this row must survive the very
             * rollback it is describing. The exception is then rethrown unchanged so the caller's
             * error handling is unaffected.
             *
             * A replay fails when the world moved while the request waited: the email was taken, the
             * role was renamed, the target was deleted, the remote refused the callback. Each of those
             * is a real operational event, and a run of them against one module is a signal.
             */
            var actorName = await db.Users.AsNoTracking()
                .Where(u => u.Id == checkerUserId).Select(u => u.Name).FirstOrDefaultAsync(ct);

            await auditLog.WriteHostAsync(
                checkerUserId, actorName, "approval.replay_failed",
                AuditLogAppService.Modules.Approvals, AuditLogAppService.Categories.Approval,
                entityType: "ApprovalRequest", entityId: request.Id.ToString(),
                details: $"Approving {request.Action} on {request.Module}" +
                         (request.EntityLabel is not null ? $" ({request.EntityLabel})" : "") +
                         $" could not be applied, so the request is still Pending. Requested by {request.MakerName}.",
                entityLabel: request.EntityLabel, result: "Failure",
                failureReason: ex.Message, correlationId: request.CorrelationId, ct: ct);

            throw;
        }

        var checkerName = await db.Users.AsNoTracking().Where(u => u.Id == checkerUserId).Select(u => u.Name).FirstOrDefaultAsync(ct);
        await auditLog.WriteHostAsync(
            checkerUserId, checkerName, "approval.approved",
            AuditLogAppService.Modules.Approvals, AuditLogAppService.Categories.Approval,
            entityType: "ApprovalRequest", entityId: request.Id.ToString(),
            details: $"Approved {request.Action} on {request.Module}" + (request.EntityLabel is not null ? $" ({request.EntityLabel})" : "") + $" — requested by {request.MakerName}.",
            entityLabel: request.EntityLabel, correlationId: request.CorrelationId, ct: ct);

        if (issuedTempPassword is not null)
        {
            // Names WHO the password is for and WHO must collect it — never the password itself.
            // The audit log is readable by anyone holding host.system.audit-logs:View, a far wider
            // audience than the single maker the secret is meant for.
            await auditLog.WriteHostAsync(
                checkerUserId, checkerName, "user.temp_password_issued",
                AuditLogAppService.Modules.Approvals, AuditLogAppService.Categories.Approval,
                entityType: "ApprovalRequest", entityId: request.Id.ToString(),
                details: $"A one-time temporary password was issued for {request.EntityLabel ?? "the new account"} and is waiting for {request.MakerName} to collect from My Requests.",
                entityLabel: request.EntityLabel, correlationId: request.CorrelationId, ct: ct);
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
        await EnsureDecidableAsync(request, checkerUserId, isAdministrator, "reject", ct);

        if (!string.IsNullOrWhiteSpace(request.CorrelationId))
        {
            auditLog.SeedCorrelationId(request.CorrelationId);
        }

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
        await auditLog.WriteHostAsync(
            checkerUserId, checkerName, "approval.rejected",
            AuditLogAppService.Modules.Approvals, AuditLogAppService.Categories.Approval,
            entityType: "ApprovalRequest", entityId: request.Id.ToString(),
            details: $"Rejected {request.Action} on {request.Module}" + (request.EntityLabel is not null ? $" ({request.EntityLabel})" : "") + $" — requested by {request.MakerName}. Reason: {reason}",
            entityLabel: request.EntityLabel, correlationId: request.CorrelationId, ct: ct);

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
        await auditLog.WriteHostAsync(
            callerUserId, makerName, "user.temp_password_revealed",
            AuditLogAppService.Modules.Approvals, AuditLogAppService.Categories.Approval,
            entityType: "ApprovalRequest", entityId: request.Id.ToString(),
            details: $"Collected the one-time temporary password for {request.EntityLabel ?? "a new account"}. It is no longer retrievable.",
            entityLabel: request.EntityLabel, correlationId: request.CorrelationId, ct: ct);

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

    /// <summary>
    /// <see cref="EnsureDecidable"/>, with every refusal written to the audit trail before it is rethrown.
    /// </summary>
    /// <remarks>
    /// A refused decision used to leave no trace at all. The most important of these is a maker trying
    /// to approve their own request: that is an attempt to defeat segregation of duties, the one thing
    /// Maker-Checker exists to enforce, and the trail showed nothing — only the eventual legitimate
    /// approval. A checker acting on a request assigned to someone else, and a second decision on an
    /// already-decided request, are recorded under the same key for the same reason: each is someone
    /// trying to decide something they may not.
    ///
    /// The row carries the request's correlation id, so it appears in that operation's Related Activity
    /// next to the request it tried to decide.
    /// </remarks>
    private async Task EnsureDecidableAsync(ApprovalRequest request, Guid checkerUserId, bool isAdministrator, string decision, CancellationToken ct)
    {
        try
        {
            EnsureDecidable(request, checkerUserId, isAdministrator);
        }
        catch (Exception ex) when (ex is ConflictAppException or ForbiddenAppException)
        {
            var actorName = await db.Users.AsNoTracking()
                .Where(u => u.Id == checkerUserId).Select(u => u.Name).FirstOrDefaultAsync(ct);

            await auditLog.WriteHostAsync(
                checkerUserId, actorName, "approval.decision_refused",
                AuditLogAppService.Modules.Approvals, AuditLogAppService.Categories.Approval,
                entityType: "ApprovalRequest", entityId: request.Id.ToString(),
                details: $"Refused an attempt to {decision} {request.Action} on {request.Module}" +
                         (request.EntityLabel is not null ? $" ({request.EntityLabel})" : "") +
                         $" — requested by {request.MakerName}, currently {request.Status}.",
                entityLabel: request.EntityLabel, result: "Failure",
                failureReason: ex.Message, correlationId: request.CorrelationId, ct: ct);

            throw;
        }
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
                    createSnapshot.RoleId, createSnapshot.IsActive, createSnapshot.AuthProvider ?? "Local",
                    createSnapshot.CustomFields, createSnapshot.Salutation);
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
                        updateSnapshot.RoleId, updateSnapshot.IsActive, updateSnapshot.CustomFields,
                        updateSnapshot.Salutation);
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

            /*
             * Remote-app registration. In-process since the Module Registry was absorbed, so these sit
             * ABOVE the default case and never touch RemoteReplayGuard.
             *
             * That is deliberate, and the guard's own comment explains why: it exists because an HTTP
             * POST to another service's database is outside this transaction's rollback, so a retried
             * execution strategy would apply the mutation twice. These calls are inside the
             * transaction, are rolled back with it, and therefore MUST re-run on a retry. Placing them
             * under `default:` would let the guard skip the replay on the second attempt and leave the
             * request marked Approved with nothing applied.
             *
             * NewDataJson is always the flat RemoteAppSnapshotDto — never a live request DTO — so the
             * diff pane and the replay read the same shape. Adding a field means updating the snapshot,
             * both places that build it, and the reconstruction below together.
             */
            case (ApprovalModuleKeys.Applications, ApprovalActionKeys.Create):
            {
                var snapshot = JsonSerializer.Deserialize<RemoteAppSnapshotDto>(request.NewDataJson)!;
                await remoteAppService.CreateAsync(
                    new CreateRemoteAppRequest(
                        snapshot.Key, snapshot.DisplayName, snapshot.IconKey, snapshot.ManifestUrl,
                        snapshot.PermissionsSourceUrl, snapshot.SidebarOrder),
                    request.MakerId, request.MakerName, ct, bypassApproval: true);
                break;
            }

            case (ApprovalModuleKeys.Applications, ApprovalActionKeys.Update):
            {
                var snapshot = JsonSerializer.Deserialize<RemoteAppSnapshotDto>(request.NewDataJson)!;
                await remoteAppService.UpdateAsync(
                    Guid.Parse(request.EntityId!),
                    new UpdateRemoteAppRequest(
                        snapshot.DisplayName, snapshot.IconKey, snapshot.ManifestUrl,
                        snapshot.PermissionsSourceUrl, snapshot.SidebarOrder),
                    request.MakerId, request.MakerName, ct, bypassApproval: true);
                break;
            }

            case (ApprovalModuleKeys.Applications, ApprovalActionKeys.Enable):
            case (ApprovalModuleKeys.Applications, ApprovalActionKeys.Disable):
            {
                var snapshot = JsonSerializer.Deserialize<RemoteAppSnapshotDto>(request.NewDataJson)!;
                await remoteAppService.UpdateStatusAsync(
                    Guid.Parse(request.EntityId!), snapshot.Status, snapshot.MaintenanceMessage,
                    request.MakerId, request.MakerName, ct, bypassApproval: true);
                break;
            }

            case (ApprovalModuleKeys.Applications, ApprovalActionKeys.Delete):
                await remoteAppService.DeleteAsync(
                    Guid.Parse(request.EntityId!), request.MakerId, request.MakerName, ct, bypassApproval: true);
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
                    ct,
                    request.SourceService);
                remoteReplay.Fired = true;
                break;
        }

        return null;
    }

    /// <summary>
    /// The approval queue as a CSV file.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The Approval Center is the most compliance-relevant table on the platform — every gated change
    /// anyone made, who asked for it, who decided, and why — and it was the one screen with no export
    /// at all. Producing evidence of a period's approvals meant screenshots.
    /// </para>
    /// <para>
    /// Two columns are deliberately absent. <c>OldDataJson</c>/<c>NewDataJson</c> carry the entire
    /// payload of the change: a Create-User snapshot is a whole account record, including its
    /// permission overrides. And <c>TempPasswordCiphertext</c> is a live credential meant for exactly
    /// one person, exactly once. An export is read by a wider audience than the maker, and neither of
    /// those belongs in a file that leaves the platform. The diff stays visible in the detail pane to
    /// anyone holding <c>host.system.approvals:View</c>.
    /// </para>
    /// </remarks>
    public async Task<CsvExport> ExportCsvAsync(ApprovalFilter filter, CancellationToken ct = default)
    {
        const int maxRows = 10_000;
        var query = BuildFilteredQuery(filter);

        var matched = await query.CountAsync(ct);
        var rows = await Order(query, filter).Take(maxRows).ToListAsync(ct);

        var csv = new CsvBuilder(
            "RequestedAt", "DecidedAt", "Module", "Action", "EntityType", "EntityLabel",
            "Status", "Maker", "Checker", "RejectionReason", "SourceService", "Id");

        foreach (var r in rows)
        {
            csv.AppendRow(
                r.RequestedAt.ToString("O"), r.DecidedAt?.ToString("O"), r.Module, r.Action,
                r.EntityType, r.EntityLabel, r.Status, r.MakerName, r.CheckerName,
                r.RejectionReason, r.SourceService, r.Id.ToString());
        }

        return new CsvExport(csv.ToString(), rows.Count, matched, maxRows);
    }

    /// <summary>The one query builder behind the list, the facets and the export.</summary>
    /// <remarks>
    /// The three substring filters lower-case both sides so they match the way the browser's
    /// client-side filters used to — Postgres <c>LIKE</c> is case-sensitive, and a search for "asha"
    /// that stopped finding "Asha" once it moved server-side would read as data loss.
    /// </remarks>
    private IQueryable<ApprovalRequest> BuildFilteredQuery(ApprovalFilter f)
    {
        var query = db.ApprovalRequests.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(f.Module)) query = query.Where(r => r.Module == f.Module);

        // An array, not the IReadOnlyList itself: array Contains is what every provider translates to IN.
        var statuses = f.Statuses.ToArray();
        if (statuses.Length == 1)
        {
            var only = statuses[0];
            query = query.Where(r => r.Status == only);
        }
        else if (statuses.Length > 1)
        {
            query = query.Where(r => statuses.Contains(r.Status));
        }

        if (!string.IsNullOrWhiteSpace(f.Action)) query = query.Where(r => r.Action == f.Action);
        if (f.MakerId is not null) query = query.Where(r => r.MakerId == f.MakerId);
        if (f.CheckerId is not null) query = query.Where(r => r.CheckerId == f.CheckerId);

        if (!string.IsNullOrWhiteSpace(f.MakerName))
        {
            var needle = f.MakerName.Trim().ToLower();
            query = query.Where(r => r.MakerName != null && r.MakerName.ToLower().Contains(needle));
        }
        if (!string.IsNullOrWhiteSpace(f.CheckerName))
        {
            var needle = f.CheckerName.Trim().ToLower();
            query = query.Where(r => r.CheckerName != null && r.CheckerName.ToLower().Contains(needle));
        }
        if (!string.IsNullOrWhiteSpace(f.EntityLabel))
        {
            var needle = f.EntityLabel.Trim().ToLower();
            query = query.Where(r => r.EntityLabel != null && r.EntityLabel.ToLower().Contains(needle));
        }

        if (f.From is not null) query = query.Where(r => r.RequestedAt >= f.From);
        if (f.To is not null) query = query.Where(r => r.RequestedAt <= f.To);
        if (f.DecidedFrom is not null) query = query.Where(r => r.DecidedAt >= f.DecidedFrom);
        if (f.DecidedTo is not null) query = query.Where(r => r.DecidedAt <= f.DecidedTo);

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
