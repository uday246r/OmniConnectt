using AuthService.Application.DTOs;
using AuthService.Application.Exceptions;
using AuthService.Domain.Entities;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Seed;
using Microsoft.EntityFrameworkCore;

namespace AuthService.Application.Services;

/// <summary>
/// Admin-facing CRUD over which users are eligible checkers for which module. A module is gated
/// (Maker-Checker required) if and only if it has at least one row here — see
/// ApprovalGatingService.IsGatedAsync.
/// </summary>
public class CheckerAssignmentAppService(AuthDbContext db, AuditLogAppService auditLog, PermissionCatalogAppService catalog, ApprovalGatingService gating)
{
    private const string ServiceName = "AuthService";

    public async Task<IReadOnlyList<CheckerAssignmentDto>> ListAsync(string? module, CancellationToken ct = default)
    {
        var query = db.CheckerAssignments.AsNoTracking()
            .Include(c => c.CheckerUser)
            .Include(c => c.CheckerRole)
            .AsQueryable();
        if (!string.IsNullOrWhiteSpace(module))
        {
            query = query.Where(c => c.Module == module);
        }

        var rows = await query
            .OrderBy(c => c.Module)
            // Role assignments sort after individuals within a module, then by name — a stable order
            // that does not depend on which of the two name columns is populated.
            .ThenBy(c => c.CheckerUserId == null)
            .ThenBy(c => c.CheckerUser!.Name)
            .ThenBy(c => c.CheckerRole!.Name)
            .Select(c => new
            {
                c.Id,
                c.Module,
                c.CheckerUserId,
                c.CheckerRoleId,
                UserName = c.CheckerUser!.Name,
                RoleName = c.CheckerRole!.Name,
                c.CreatedAt,
            })
            .ToListAsync(ct);

        /*
         * Active member counts for every assigned role, in one query rather than one per row.
         *
         * This is shown because "assigned to Manager" tells an administrator nothing about whether
         * anyone can actually approve. A role with zero active members gates a module with no way to
         * clear the queue, and that needs to be visible in the list rather than discovered when a
         * request cannot be routed.
         */
        var roleIds = rows.Where(r => r.CheckerRoleId.HasValue).Select(r => r.CheckerRoleId!.Value).Distinct().ToList();
        var memberCounts = roleIds.Count == 0
            ? []
            : await db.Users.AsNoTracking()
                .Where(u => u.RoleId != null && roleIds.Contains(u.RoleId.Value) && u.Status == Domain.Enums.UserStatus.Active)
                .GroupBy(u => u.RoleId!.Value)
                .Select(g => new { RoleId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.RoleId, x => x.Count, ct);

        return rows.Select(r => new CheckerAssignmentDto(
            r.Id,
            r.Module,
            r.CheckerUserId,
            r.CheckerRoleId,
            /*
             * The name can come back null for an assignment pointing at a SOFT-DELETED user: Users
             * carries a global query filter (!IsDeleted), so the navigation silently resolves to
             * nothing and the row rendered as a nameless chip.
             *
             * Such an assignment is inert — the checker-selection path filters on Status == Active,
             * which a deleted account can never satisfy — but it is dead weight that an administrator
             * should be able to see and remove. Naming it explicitly beats a blank.
             *
             * New occurrences are prevented: deleting or deactivating a checker now reassigns their
             * pending work or refuses outright. Rows predating that guard can still exist.
             */
            r.CheckerRoleId.HasValue ? (r.RoleName ?? "(deleted role)") : (r.UserName ?? "(deleted user)"),
            r.CheckerRoleId.HasValue,
            r.CheckerRoleId.HasValue ? memberCounts.GetValueOrDefault(r.CheckerRoleId.Value, 0) : null,
            r.CreatedAt)).ToList();
    }

    /// <summary>
    /// Every module the Checker Assignment UI may offer a checker for — every active top-level and
    /// sub-module <c>PermissionFeature</c>, the exact same live catalog the Role editor renders. Users
    /// and Roles are no longer special-cased here: ApprovalModuleKeys.Users/Roles are literally
    /// AuthDbSeeder.HostFeatureKeys.SettingsUsers/SettingsRoles, so they already appear in this catalog
    /// like any other host feature. A remote app's module shows up here the moment it registers/syncs,
    /// and disappears (without deleting its existing assignments) the moment it's deactivated — no
    /// code change on this side ever, for any module.
    /// </summary>
    public async Task<IReadOnlyList<AssignableModuleDto>> GetAssignableModulesAsync(CancellationToken ct = default)
    {
        var features = await catalog.GetCatalogAsync(activeOnly: true, ct);
        var excluded = new HashSet<string>(StringComparer.Ordinal)
        {
            AuthDbSeeder.HostFeatureKeys.SystemApprovals,
            AuthDbSeeder.HostFeatureKeys.SystemCheckerAssignment,
        };

        var modules = new List<AssignableModuleDto>();
        foreach (var feature in features.Where(f => !excluded.Contains(f.Key)))
        {
            modules.Add(new AssignableModuleDto(feature.Key, feature.DisplayName));
            foreach (var child in feature.Children)
            {
                modules.Add(new AssignableModuleDto(child.Key, $"{feature.DisplayName} — {child.DisplayName}"));
            }
        }

        return modules;
    }

    public async Task<CheckerAssignmentDto> UpsertAsync(
        string module, Guid? checkerUserId, Guid? checkerRoleId, Guid? actingUserId, CancellationToken ct = default)
    {
        var assignable = await GetAssignableModulesAsync(ct);
        if (!assignable.Any(m => m.Key == module))
        {
            throw new ValidationAppException($"'{module}' is not a known, assignable module.");
        }

        // Exactly one target. Checked here as well as by the database constraint so the caller gets a
        // sentence explaining the rule rather than a raw constraint violation.
        if (checkerUserId.HasValue == checkerRoleId.HasValue)
        {
            throw new ValidationAppException(
                "Assign either a specific user or a role as checker — not both, and not neither.");
        }

        string checkerName;
        int? memberCount = null;

        if (checkerUserId.HasValue)
        {
            var checkerUser = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == checkerUserId.Value, ct)
                ?? throw new NotFoundAppException($"User '{checkerUserId}' was not found.");

            /*
             * An inactive account cannot sign in, so it cannot approve anything. Assigning one looks like
             * it worked, silently reduces the pool of checkers the balancer can actually use, and — if it
             * were the only assignment — would make the module "gated" with nobody able to clear the queue.
             * Refuse it at the point of assignment, where the administrator can still see why.
             */
            if (checkerUser.Status != Domain.Enums.UserStatus.Active)
            {
                throw new ValidationAppException(
                    $"{checkerUser.Name} is not an active user and cannot be assigned as a checker.");
            }

            checkerName = checkerUser.Name;
        }
        else
        {
            var role = await db.Roles.AsNoTracking().FirstOrDefaultAsync(r => r.Id == checkerRoleId!.Value, ct)
                ?? throw new NotFoundAppException($"Role '{checkerRoleId}' was not found.");

            /*
             * Same reasoning as the inactive-user check, one level up: a role with no active members
             * expands to an empty checker pool, so it would gate the module with nobody able to clear
             * the queue. Refused at assignment time rather than discovered when a request cannot be
             * routed.
             *
             * Membership is NOT frozen here — it is re-resolved on every selection, so this only
             * asserts the role is usable today. A role that later loses all its members is handled by
             * the departing-checker reassignment path.
             */
            memberCount = await db.Users.AsNoTracking()
                .CountAsync(u => u.RoleId == checkerRoleId!.Value && u.Status == Domain.Enums.UserStatus.Active, ct);

            if (memberCount == 0)
            {
                throw new ValidationAppException(
                    $"'{role.Name}' has no active members, so assigning it as checker would leave this module with nobody able to approve.");
            }

            checkerName = role.Name;
        }

        var existing = await db.CheckerAssignments.FirstOrDefaultAsync(
            c => c.Module == module
                && c.CheckerUserId == checkerUserId
                && c.CheckerRoleId == checkerRoleId, ct);
        if (existing is not null)
        {
            // Already assigned — treat as a no-op success rather than a conflict, so the UI doesn't
            // need to pre-check before offering "Add Checker".
            return new CheckerAssignmentDto(
                existing.Id, existing.Module, existing.CheckerUserId, existing.CheckerRoleId,
                checkerName, existing.CheckerRoleId.HasValue, memberCount, existing.CreatedAt);
        }

        var assignment = new CheckerAssignment
        {
            Id = Guid.NewGuid(),
            Module = module,
            CheckerUserId = checkerUserId,
            CheckerRoleId = checkerRoleId,
            CreatedAt = DateTimeOffset.UtcNow,
            CreatedBy = actingUserId,
        };
        db.CheckerAssignments.Add(assignment);
        await db.SaveChangesAsync(ct);

        var actorName = actingUserId is null ? null : await db.Users.AsNoTracking().Where(u => u.Id == actingUserId).Select(u => u.Name).FirstOrDefaultAsync(ct);
        await auditLog.WriteAsync(
            ServiceName, actingUserId, actorName, "checker_assignment.created", "CheckerAssignment", assignment.Id.ToString(),
            $"Assigned {(checkerRoleId.HasValue ? "role " : string.Empty)}{checkerName} as a checker for '{module}'.", entityLabel: module, ct: ct);

        return new CheckerAssignmentDto(
            assignment.Id, module, checkerUserId, checkerRoleId, checkerName,
            checkerRoleId.HasValue, memberCount, assignment.CreatedAt);
    }

    /// <summary>
    /// Removing a checker must never strand an already-Pending request with nobody able to act on it —
    /// EnsureDecidable's exact-CheckerId match means literally nobody, not even a Super Admin, could
    /// approve/reject a request left pointing at a checker who's no longer assigned. So: reassign every
    /// affected Pending request to another eligible checker for the same module when one exists; if
    /// even one affected request has no eligible replacement (e.g. the only remaining checker is that
    /// request's own maker), the whole removal is refused — atomic all-or-nothing, never a partial
    /// reassign-some-strand-others outcome.
    /// </summary>
    public async Task DeleteAsync(Guid id, Guid? actingUserId, CancellationToken ct = default)
    {
        var assignment = await db.CheckerAssignments
            .Include(c => c.CheckerUser)
            .Include(c => c.CheckerRole)
            .FirstOrDefaultAsync(c => c.Id == id, ct)
            ?? throw new NotFoundAppException($"Checker assignment '{id}' was not found.");

        var module = assignment.Module;
        var checkerName = assignment.CheckerRole?.Name ?? assignment.CheckerUser?.Name ?? "Unknown";

        /*
         * Who would still be eligible for this module once this assignment is gone?
         *
         * Framing it this way — rather than "requests whose checker is the removed user" — is what
         * makes role assignments work: removing a role assignment can strip eligibility from several
         * people at once, and there is no single CheckerUserId to compare against.
         *
         * It also corrects a subtler case that the old per-user query got wrong: someone assigned BOTH
         * individually and through a role stays eligible when one of those two assignments is removed,
         * so their pending requests should not be reassigned at all. Comparing against the surviving
         * eligible set gets that right by construction.
         */
        var remainingEligible = await gating.ResolveEligibleCheckerIdsAsync(module, excludeUserId: null, ct, ignoreAssignmentId: id);
        var remainingSet = remainingEligible.ToHashSet();

        var affected = (await db.ApprovalRequests
                .Where(r => r.Status == ApprovalStatus.Pending && r.Module == module)
                .ToListAsync(ct))
            .Where(r => !remainingSet.Contains(r.CheckerId))
            .ToList();

        var reassignments = new List<(ApprovalRequest Request, Guid NewCheckerId, string? NewCheckerName)>();
        if (affected.Count > 0)
        {
            foreach (var request in affected)
            {
                // Each request excludes its OWN maker: a replacement who happens to be the maker would
                // reintroduce exactly the self-approval this system exists to prevent.
                var eligibleForThisRequest = remainingEligible.Where(cid => cid != request.MakerId).ToList();
                var replacement = await gating.TrySelectCheckerAsync(module, eligibleForThisRequest, ct);
                if (replacement is null)
                {
                    throw new ConflictAppException(
                        $"Cannot remove {checkerName} as a checker for '{module}' — {affected.Count} pending request(s) would have no eligible checker. Assign another checker to '{module}' first, or resolve the pending request(s).");
                }

                reassignments.Add((request, replacement.Value.CheckerId, replacement.Value.CheckerName));
            }
        }

        var actorName = actingUserId is null ? null : await db.Users.AsNoTracking().Where(u => u.Id == actingUserId).Select(u => u.Name).FirstOrDefaultAsync(ct);

        foreach (var (request, newCheckerId, newCheckerName) in reassignments)
        {
            var oldCheckerName = request.CheckerName;
            request.CheckerId = newCheckerId;
            request.CheckerName = newCheckerName;
            await auditLog.WriteAsync(
                ServiceName, actingUserId, actorName, "approval.reassigned", "ApprovalRequest", request.Id.ToString(),
                $"Reassigned from {oldCheckerName ?? "Unknown"} to {newCheckerName ?? "Unknown"} on '{module}' — checker was unassigned from the module.",
                entityLabel: request.EntityLabel, ct: ct);
        }

        db.CheckerAssignments.Remove(assignment);
        await db.SaveChangesAsync(ct);

        await auditLog.WriteAsync(
            ServiceName, actingUserId, actorName, "checker_assignment.deleted", "CheckerAssignment", id.ToString(),
            $"Removed {(assignment.CheckerRoleId.HasValue ? "role " : string.Empty)}{checkerName} as a checker for '{module}'.", entityLabel: module, ct: ct);
    }
}
