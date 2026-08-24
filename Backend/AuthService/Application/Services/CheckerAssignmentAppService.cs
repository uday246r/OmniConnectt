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
        var query = db.CheckerAssignments.AsNoTracking().Include(c => c.CheckerUser).AsQueryable();
        if (!string.IsNullOrWhiteSpace(module))
        {
            query = query.Where(c => c.Module == module);
        }

        return await query
            .OrderBy(c => c.Module).ThenBy(c => c.CheckerUser!.Name)
            .Select(c => new CheckerAssignmentDto(c.Id, c.Module, c.CheckerUserId, c.CheckerUser!.Name, c.CreatedAt))
            .ToListAsync(ct);
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

    public async Task<CheckerAssignmentDto> UpsertAsync(string module, Guid checkerUserId, Guid? actingUserId, CancellationToken ct = default)
    {
        var assignable = await GetAssignableModulesAsync(ct);
        if (!assignable.Any(m => m.Key == module))
        {
            throw new ValidationAppException($"'{module}' is not a known, assignable module.");
        }

        var checkerUser = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == checkerUserId, ct)
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

        var existing = await db.CheckerAssignments.FirstOrDefaultAsync(c => c.Module == module && c.CheckerUserId == checkerUserId, ct);
        if (existing is not null)
        {
            // Already assigned — treat as a no-op success rather than a conflict, so the UI doesn't
            // need to pre-check before offering "Add Checker".
            return new CheckerAssignmentDto(existing.Id, existing.Module, existing.CheckerUserId, checkerUser.Name, existing.CreatedAt);
        }

        var assignment = new CheckerAssignment
        {
            Id = Guid.NewGuid(),
            Module = module,
            CheckerUserId = checkerUserId,
            CreatedAt = DateTimeOffset.UtcNow,
            CreatedBy = actingUserId,
        };
        db.CheckerAssignments.Add(assignment);
        await db.SaveChangesAsync(ct);

        var actorName = actingUserId is null ? null : await db.Users.AsNoTracking().Where(u => u.Id == actingUserId).Select(u => u.Name).FirstOrDefaultAsync(ct);
        await auditLog.WriteAsync(
            ServiceName, actingUserId, actorName, "checker_assignment.created", "CheckerAssignment", assignment.Id.ToString(),
            $"Assigned {checkerUser.Name} as a checker for '{module}'.", entityLabel: module, ct: ct);

        return new CheckerAssignmentDto(assignment.Id, module, checkerUserId, checkerUser.Name, assignment.CreatedAt);
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
        var assignment = await db.CheckerAssignments.Include(c => c.CheckerUser).FirstOrDefaultAsync(c => c.Id == id, ct)
            ?? throw new NotFoundAppException($"Checker assignment '{id}' was not found.");

        var module = assignment.Module;
        var checkerName = assignment.CheckerUser?.Name ?? "Unknown";

        var affected = await db.ApprovalRequests
            .Where(r => r.Status == ApprovalStatus.Pending && r.Module == module && r.CheckerId == assignment.CheckerUserId)
            .ToListAsync(ct);

        var reassignments = new List<(ApprovalRequest Request, Guid NewCheckerId, string? NewCheckerName)>();
        if (affected.Count > 0)
        {
            // The eligible set once this assignment is gone — every OTHER active CheckerAssignment row
            // for the same module, regardless of which request's maker excludes which checker (that
            // exclusion happens per-request below, via TrySelectCheckerAsync's maker check happening
            // implicitly through the caller-supplied set here already excluding nobody — each request
            // still needs its own maker excluded individually).
            var remainingAssignmentCheckerIds = await db.CheckerAssignments.AsNoTracking()
                .Where(c => c.Module == module && c.Id != id)
                .Select(c => c.CheckerUserId)
                .Distinct()
                .ToListAsync(ct);

            foreach (var request in affected)
            {
                var eligibleForThisRequest = remainingAssignmentCheckerIds.Where(cid => cid != request.MakerId).ToList();
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
            $"Removed {checkerName} as a checker for '{module}'.", entityLabel: module, ct: ct);
    }
}
