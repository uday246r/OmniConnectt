using AuthService.Application.DTOs;
using AuthService.Application.Events;
using AuthService.Application.Exceptions;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Data.SqlClient;

namespace AuthService.Application.Services;

/// <summary>
/// The maker-side half of the approval engine — deciding whether a module is gated, and if so, writing
/// the ApprovalRequest instead of letting the caller mutate directly.
///
/// Deliberately separate from ApprovalAppService (which handles the checker-side List/Get/Approve/
/// Reject) to avoid a DI cycle: ApprovalAppService.ApproveAsync calls back into UserAppService/
/// RoleAppService to replay an approved mutation, so those two services must depend only on this one,
/// never on ApprovalAppService itself.
///
/// There is deliberately no public HTTP-reachable "create a request" endpoint anywhere in the API —
/// the only path to a new ApprovalRequest row is SubmitAsync, called from inside a gated mutation
/// method after that method's own validation has already run. A client can never fabricate an approval
/// request unconnected to a real gated attempt.
/// </summary>
public class ApprovalGatingService(AuthDbContext db, AuditLogAppService auditLog, IPlatformEventPublisher events)
{
    private const string ServiceName = "AuthService";

    public Task<bool> IsGatedAsync(string module, CancellationToken ct = default) =>
        db.CheckerAssignments.AnyAsync(c => c.Module == module, ct);

    /// <summary>
    /// Refuses an un-attributable mutation on a gated module.
    ///
    /// Every gating check reads `!bypassApproval &amp;&amp; actingUserId is not null &amp;&amp; IsGatedAsync(...)`, so a
    /// null acting user falls straight through to the direct-mutation path — a maker-checker bypass
    /// that leaves no maker to record. In practice `[Authorize]` plus a well-formed token always yields
    /// a `sub`, so this should be unreachable; if it ever isn't, failing loudly is the only safe
    /// reading. An approval workflow with no identifiable maker is not an approval workflow.
    /// </summary>
    public async Task EnsureActorIdentifiedAsync(string module, Guid? actingUserId, CancellationToken ct = default)
    {
        if (actingUserId is not null)
        {
            return;
        }

        if (await IsGatedAsync(module, ct))
        {
            throw new ForbiddenAppException(
                $"'{module}' requires approval, and this request could not be attributed to a signed-in user. Sign in again and retry.");
        }
    }

    /// <summary>
    /// <paramref name="sourceService"/>/<paramref name="callbackUrl"/>/<paramref name="correlationId"/>
    /// default to AuthService's own in-process values — UserAppService/RoleAppService's call sites are
    /// unaffected. A remote service submitting through InternalApprovalsController passes its own name,
    /// a callback URL to its own internal/approvals/apply endpoint, and a correlation id; ApprovalAppService.
    /// ReplayAsync's default case uses exactly these three fields to replay the mutation over HTTP instead
    /// of an in-process switch case.
    /// </summary>
    public async Task<ApprovalPendingDto> SubmitAsync(
        string module, string action, string? entityType, string? entityId, string? entityLabel,
        string? oldDataJson, string newDataJson, Guid makerId, CancellationToken ct = default,
        string sourceService = ServiceName, string? callbackUrl = null, string? correlationId = null,
        string? entityKey = null)
    {
        // Falls back to the entity id, which is the correct key for every action against a record that
        // already exists. Only Create needs to supply something else (a natural key), since it has no
        // id yet — see ApprovalRequest.EntityKey.
        var resolvedKey = entityKey ?? entityId;

        // A remote submission already brings its own id (its own request's correlation, forwarded
        // through InternalApprovalsController); an in-process one (UserAppService/RoleAppService)
        // never passes one, so this captures THIS submit request's own id and — critically — stores
        // it on the ApprovalRequest, so ApproveAsync/RejectAsync can hand it back via SeedCorrelationId
        // on whatever later request decides it, keeping "requested" and "approved" in one thread.
        correlationId ??= auditLog.ResolveCorrelationId();

        await EnsureNoOpenRequestAsync(module, resolvedKey, makerId, ct);

        var makerName = await db.Users.AsNoTracking().Where(u => u.Id == makerId).Select(u => u.Name).FirstOrDefaultAsync(ct);
        var (checkerId, checkerName) = await SelectCheckerAsync(module, makerId, ct);

        var request = new ApprovalRequest
        {
            Id = Guid.NewGuid(),
            Module = module,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            EntityLabel = entityLabel,
            EntityKey = resolvedKey,
            OldDataJson = oldDataJson,
            NewDataJson = newDataJson,
            Status = ApprovalStatus.Pending,
            MakerId = makerId,
            MakerName = makerName,
            CheckerId = checkerId,
            CheckerName = checkerName,
            RequestedAt = DateTimeOffset.UtcNow,
            SourceService = sourceService,
            CallbackUrl = callbackUrl,
            CorrelationId = correlationId,
        };
        db.ApprovalRequests.Add(request);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (ex.InnerException is SqlException sqlEx && (sqlEx.Number == 2601 || sqlEx.Number == 2627))
        {
            // Lost the race: another submission for this same record committed between our check above
            // and this save. Detach the row we failed to insert so the retry below reads clean, then
            // re-run the check — it will now find the winner and throw the same friendly
            // PendingApprovalConflictException a sequential caller would have got.
            db.Entry(request).State = EntityState.Detached;
            await EnsureNoOpenRequestAsync(module, resolvedKey, makerId, ct);

            // Defensive: the index fired but no Pending row is visible (e.g. the winner was decided in
            // the interim). Surface a plain conflict rather than pretending the write succeeded.
            throw new ConflictAppException(
                "Another change to this record was submitted at the same moment. Please refresh and try again.");
        }

        await auditLog.WriteAsync(
            ServiceName, makerId, makerName, "approval.requested", "ApprovalRequest", request.Id.ToString(),
            $"Requested {action} on {module}" + (entityLabel is not null ? $" ({entityLabel})" : "") + $" — assigned to {checkerName ?? "an eligible checker"}.",
            entityLabel: entityLabel, correlationId: correlationId, ct: ct);

        var interestedUsers = new List<Guid> { makerId, checkerId };
        await events.PublishToApprovalViewersAsync(new PlatformEvent("approvals", "requested"), ct);
        await events.PublishToUsersAsync(interestedUsers, new PlatformEvent("approvals", "requested"), ct);
        var count = await db.ApprovalRequests.CountAsync(r => r.CheckerId == checkerId && r.Status == ApprovalStatus.Pending, ct);
        await events.PublishBadgeAsync(checkerId, count, ct);

        return new ApprovalPendingDto(request.Id, module, action, checkerName ?? "Unassigned");
    }

    /// <summary>
    /// Refuses a second open request against a record that already has one.
    ///
    /// Without this, a maker who submits "delete this user", sees nothing happen in the list (because
    /// nothing HAS happened — it is awaiting approval), and clicks delete again, silently queues a
    /// second request. Both then sit in the checker's queue, and approving both replays the mutation
    /// twice. For a soft delete that second replay succeeds silently rather than erroring, so the
    /// duplicate is invisible in the data and only shows up as a confusing pair of rows in the audit
    /// trail. The same applies to two different makers acting on the same record concurrently.
    ///
    /// The friendly error is produced here; the partial unique index on (Module, EntityKey) WHERE
    /// Status = 'Pending' (see AuthDbContext) is what holds the line when two submissions race past
    /// this check before either commits — SubmitAsync translates that violation back into this same
    /// exception so the caller gets one consistent experience either way.
    /// </summary>
    private async Task EnsureNoOpenRequestAsync(string module, string? entityKey, Guid makerId, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(entityKey))
        {
            // No stable identity to deduplicate on. Rather than guess, allow it — the DB index treats
            // NULL keys as distinct too, so behaviour is consistent at both layers.
            return;
        }

        var existing = await db.ApprovalRequests.AsNoTracking()
            .Where(r => r.Module == module && r.EntityKey == entityKey && r.Status == ApprovalStatus.Pending)
            .OrderBy(r => r.RequestedAt)
            .Select(r => new { r.Id, r.Module, r.Action, r.EntityLabel, r.MakerId, r.MakerName, r.CheckerName, r.RequestedAt })
            .FirstOrDefaultAsync(ct);

        if (existing is null)
        {
            return;
        }

        var isOwn = existing.MakerId == makerId;
        var subject = existing.EntityLabel is not null ? $" on '{existing.EntityLabel}'" : "";
        var raisedBy = isOwn ? "You" : existing.MakerName ?? "Another user";
        var verb = isOwn ? "have" : "has";

        throw new PendingApprovalConflictException(
            $"{raisedBy} already {verb} a pending {existing.Action} request{subject} awaiting approval" +
            (existing.CheckerName is not null ? $" from {existing.CheckerName}" : "") +
            ". It must be approved or rejected before another change can be requested.",
            new PendingApprovalConflictDto(
                existing.Id, existing.Module, existing.Action, existing.EntityLabel,
                existing.MakerName, existing.CheckerName, existing.RequestedAt, isOwn));
    }

    /// <summary>
    /// Least-current-Pending-workload selection among a module's assigned checkers: picks whichever
    /// eligible checker currently has the fewest Pending requests assigned to them. Deterministic
    /// (ties broken by Id), needs no extra state (computed live from existing ApprovalRequest rows),
    /// and load-balances for free.
    ///
    /// Excludes the maker themselves — a module whose only eligible checker is also its maker must
    /// never silently self-approve; instead the mutation is rejected outright, per the confirmed rule
    /// that a maker can never approve their own request.
    /// </summary>
    private async Task<(Guid CheckerId, string? CheckerName)> SelectCheckerAsync(string module, Guid makerId, CancellationToken ct)
    {
        var eligible = await ResolveEligibleCheckerIdsAsync(module, makerId, ct);

        if (eligible.Count == 0)
        {
            throw new ConflictAppException(
                $"No eligible checker is assigned to '{module}' other than yourself. Ask an administrator to assign another checker.");
        }

        var result = await TrySelectCheckerAsync(module, eligible, ct);
        return result ?? throw new ConflictAppException($"All checkers assigned to '{module}' are currently inactive.");
    }

    /// <summary>
    /// Moves every request still waiting on a checker who is about to lose the ability to act — because
    /// their account is being deactivated or deleted — onto someone who can, or refuses the change.
    ///
    /// Without this, disabling a checker silently strands their queue: the request stays Pending and
    /// assigned to them forever, EnsureDecidable insists only the assigned checker may act, and that
    /// person can no longer sign in. The maker sees a request that never resolves and nobody can
    /// explain why. Removing a checker from a MODULE already handled this correctly
    /// (CheckerAssignmentAppService.DeleteAsync); disabling the underlying USER did not, which is the
    /// same hole reached by a different door.
    ///
    /// Spans every module the departing checker holds, since deactivating an account takes them out of
    /// all of them at once. Mutates tracked entities and writes the audit rows; the CALLER commits, so
    /// the reassignment lands in the same transaction as the deactivation that caused it.
    /// </summary>
    internal async Task ReassignPendingRequestsForDepartingCheckerAsync(
        Guid departingCheckerId, Guid? actingUserId, string reason, CancellationToken ct)
    {
        var affected = await db.ApprovalRequests
            .Where(r => r.Status == ApprovalStatus.Pending && r.CheckerId == departingCheckerId)
            .ToListAsync(ct);

        if (affected.Count == 0)
        {
            return;
        }

        var departingName = await db.Users.AsNoTracking()
            .Where(u => u.Id == departingCheckerId).Select(u => u.Name).FirstOrDefaultAsync(ct) ?? "That user";

        // One lookup per module involved, rather than one per request. Role assignments are expanded
        // here too, so a module whose only checker "assignment" is a role still finds a replacement
        // among that role's other active members.
        var modules = affected.Select(r => r.Module).Distinct().ToList();
        var assignmentsByModule = new Dictionary<string, List<Guid>>();
        foreach (var module in modules)
        {
            assignmentsByModule[module] = await ResolveEligibleCheckerIdsAsync(module, departingCheckerId, ct);
        }

        var reassignments = new List<(ApprovalRequest Request, Guid NewCheckerId, string? NewCheckerName)>();

        foreach (var request in affected)
        {
            var candidates = assignmentsByModule.TryGetValue(request.Module, out var ids) ? ids : [];
            // Each request excludes its OWN maker — a replacement who happens to be the maker would
            // re-introduce exactly the self-approval this system exists to prevent.
            var eligible = candidates.Where(cid => cid != request.MakerId).ToList();

            var replacement = await TrySelectCheckerAsync(request.Module, eligible, ct);
            if (replacement is null)
            {
                throw new ConflictAppException(
                    $"{departingName} still has {affected.Count} pending approval request(s) and there is no other " +
                    $"eligible checker for '{request.Module}' to take them on. Assign another checker to that module, " +
                    $"or have the pending request(s) approved or rejected first.");
            }

            reassignments.Add((request, replacement.Value.CheckerId, replacement.Value.CheckerName));
        }

        var actorName = actingUserId is null
            ? null
            : await db.Users.AsNoTracking().Where(u => u.Id == actingUserId).Select(u => u.Name).FirstOrDefaultAsync(ct);

        foreach (var (request, newCheckerId, newCheckerName) in reassignments)
        {
            var oldCheckerName = request.CheckerName;
            request.CheckerId = newCheckerId;
            request.CheckerName = newCheckerName;

            await auditLog.WriteAsync(
                ServiceName, actingUserId, actorName, "approval.reassigned", "ApprovalRequest", request.Id.ToString(),
                $"Reassigned from {oldCheckerName ?? "Unknown"} to {newCheckerName ?? "Unknown"} on '{request.Module}' — {reason}.",
                entityLabel: request.EntityLabel, correlationId: request.CorrelationId, ct: ct);
        }

        if (reassignments.Count > 0)
        {
            var affectedCheckerIds = reassignments
                .Select(r => r.NewCheckerId)
                .Append(departingCheckerId)
                .Distinct()
                .ToList();

            await events.PublishToApprovalViewersAsync(new PlatformEvent("approvals", "reassigned"), ct);
            await events.PublishToUsersAsync(affectedCheckerIds, new PlatformEvent("approvals", "reassigned"), ct);
            foreach (var cId in affectedCheckerIds)
            {
                var count = await db.ApprovalRequests.CountAsync(r => r.CheckerId == cId && r.Status == ApprovalStatus.Pending, ct);
                await events.PublishBadgeAsync(cId, count, ct);
            }
        }
    }

    /// <summary>
    /// Turns a module's checker assignments into the concrete set of user ids that may act on it,
    /// excluding <paramref name="excludeUserId"/> — always the request's own maker, since the whole
    /// point of the system is that nobody approves their own change.
    ///
    /// User assignments contribute their user directly. Role assignments expand to that role's ACTIVE
    /// members, resolved at selection time rather than when the assignment was created: membership
    /// changes as people join, move and leave, and a snapshot taken on the day of assignment would go
    /// stale silently. A user who is both named individually and a member of an assigned role appears
    /// once — Distinct() keeps them from being counted twice by the workload balancer.
    ///
    /// Inactive users are filtered later by <see cref="TrySelectCheckerAsync"/>, which already checks
    /// status for the direct-user case; role expansion applies the same filter here so an all-inactive
    /// role behaves exactly like an all-inactive list of individuals.
    /// </summary>
    internal async Task<List<Guid>> ResolveEligibleCheckerIdsAsync(
        string module, Guid? excludeUserId, CancellationToken ct, Guid? ignoreAssignmentId = null)
    {
        // `ignoreAssignmentId` answers "who would still be eligible if this assignment were gone?",
        // which is what removing an assignment needs to know before it strands anyone.
        var assignments = await db.CheckerAssignments.AsNoTracking()
            .Where(c => c.Module == module && (ignoreAssignmentId == null || c.Id != ignoreAssignmentId))
            .Select(c => new { c.CheckerUserId, c.CheckerRoleId })
            .ToListAsync(ct);

        if (assignments.Count == 0)
        {
            return [];
        }

        var userIds = assignments
            .Where(a => a.CheckerUserId.HasValue)
            .Select(a => a.CheckerUserId!.Value)
            .ToList();

        var roleIds = assignments
            .Where(a => a.CheckerRoleId.HasValue)
            .Select(a => a.CheckerRoleId!.Value)
            .Distinct()
            .ToList();

        if (roleIds.Count > 0)
        {
            // One query for every assigned role rather than one per role.
            var fromRoles = await db.Users.AsNoTracking()
                .Where(u => u.RoleId != null
                    && roleIds.Contains(u.RoleId.Value)
                    && u.Status == UserStatus.Active)
                .Select(u => u.Id)
                .ToListAsync(ct);

            userIds.AddRange(fromRoles);
        }

        return userIds.Where(id => excludeUserId == null || id != excludeUserId.Value).Distinct().ToList();
    }

    /// <summary>
    /// The non-throwing core of the least-workload algorithm, reused by
    /// CheckerAssignmentAppService.DeleteAsync to find a replacement for requests orphaned by a checker
    /// removal — same "fewest current Pending requests, ties by Id" selection, just over a
    /// caller-supplied eligible set (already maker-excluded) instead of always deriving it from
    /// CheckerAssignments directly. Returns null when nobody in <paramref name="eligibleCheckerIds"/> is
    /// currently Active; the caller decides what that means for them (SelectCheckerAsync throws,
    /// CheckerAssignmentAppService.DeleteAsync blocks the removal).
    /// </summary>
    internal async Task<(Guid CheckerId, string? CheckerName)?> TrySelectCheckerAsync(
        string module, IReadOnlyList<Guid> eligibleCheckerIds, CancellationToken ct)
    {
        if (eligibleCheckerIds.Count == 0)
        {
            return null;
        }

        var active = await db.Users.AsNoTracking()
            .Where(u => eligibleCheckerIds.Contains(u.Id) && u.Status == UserStatus.Active)
            .Select(u => new { u.Id, u.Name })
            .ToListAsync(ct);

        if (active.Count == 0)
        {
            return null;
        }

        // Workload is counted PER MODULE, not globally. `module` was previously accepted and never
        // used, so a checker busy on one module was silently de-prioritised for every other — making
        // the balancing look erratic to an administrator who can only see one module's queue at a time.
        var activeIds = active.Select(a => a.Id).ToList();
        var pendingCounts = await db.ApprovalRequests.AsNoTracking()
            .Where(r => r.Status == ApprovalStatus.Pending && r.Module == module && activeIds.Contains(r.CheckerId))
            .GroupBy(r => r.CheckerId)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count, ct);

        var chosen = active
            .OrderBy(a => pendingCounts.GetValueOrDefault(a.Id, 0))
            .ThenBy(a => a.Id)
            .First();

        return (chosen.Id, chosen.Name);
    }
}
