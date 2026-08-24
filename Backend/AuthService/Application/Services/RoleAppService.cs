using System.Text.Json;
using AuthService.Application.DTOs;
using AuthService.Application.Exceptions;
using AuthService.Domain.Entities;
using AuthService.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace AuthService.Application.Services;

public class RoleAppService(
    AuthDbContext db, AuditLogAppService auditLog, IHttpContextAccessor httpContextAccessor, ApprovalGatingService gating)
{
    private const string ServiceName = "AuthService";

    // Same reasoning as UserAppService: this runs in-process inside AuthService, so the ambient
    // HttpContext is the real end-user's own request, not a service-to-service hop.
    private string? SourceIp => httpContextAccessor.HttpContext?.Connection.RemoteIpAddress?.ToString();
    private string? UserAgent => httpContextAccessor.HttpContext?.Request.Headers.UserAgent.ToString();

    /// <summary>
    /// Whether the ACTING USER is an administrator, resolved from their own database record.
    ///
    /// Deliberately not read from the ambient JWT "administrator" claim, even though that claim exists
    /// and is cheaper. During an approval replay the ambient HttpContext belongs to the CHECKER, not
    /// the maker — so a claim-based check would let a super-admin checker approve a privilege
    /// escalation that the non-admin maker was never allowed to submit. Keying off actingUserId (which
    /// is the maker's id on both the submit and the replay path) makes the answer identical in both,
    /// which is the only way this guard can be trusted.
    /// </summary>
    private async Task<bool> IsActorAdministratorAsync(Guid? actingUserId, CancellationToken ct)
    {
        if (actingUserId is null)
        {
            return false;
        }

        return await db.Users.AsNoTracking()
            .Where(u => u.Id == actingUserId.Value)
            .Select(u => u.Role != null && u.Role.IsAdministrator)
            .FirstOrDefaultAsync(ct);
    }
    public async Task<PagedResult<RoleListItemDto>> ListAsync(int page, int pageSize, string? search, CancellationToken ct = default)
    {
        var query = db.Roles.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLowerInvariant();
            query = query.Where(r => r.Name.ToLower().Contains(term));
        }

        var total = await query.CountAsync(ct);
        var items = await query
            .OrderBy(r => r.Name)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(r => new RoleListItemDto(
                r.Id, r.Name, r.Description, r.IsSystemRole, r.IsAdministrator,
                r.Users.Count(u => !u.IsDeleted),
                r.RolePermissions.Count,
                r.CreatedAt))
            .ToListAsync(ct);

        return new PagedResult<RoleListItemDto>(items, total, page, pageSize);
    }

    public async Task<RoleDetailDto> GetAsync(Guid id, CancellationToken ct = default)
    {
        var role = await db.Roles.AsNoTracking().FirstOrDefaultAsync(r => r.Id == id, ct) ?? throw NotFound(id);
        var permissions = await LoadPermissionsAsync(id, ct);
        return ToDetailDto(role, permissions);
    }

    public async Task<MutationResult<RoleDetailDto>> CreateAsync(
        UpsertRoleRequest request, Guid? actingUserId, CancellationToken ct = default, bool bypassApproval = false)
    {
        var name = request.Name.Trim();
        if (await db.Roles.AnyAsync(r => r.Name == name, ct))
        {
            throw new ConflictAppException($"A role named '{name}' already exists.");
        }

        /*
         * Only an administrator may mint another administrator role.
         *
         * IsAdministrator is not an ordinary permission — PermissionClaimsBuilder short-circuits on it
         * and returns "unrestricted", so a role carrying it bypasses every capability check in the
         * platform. Without this guard, anyone holding Roles:Create could create such a role and then
         * (with Users:Edit) assign it to themselves or an accomplice — a complete privilege escalation
         * that, on a gated module, another non-admin checker could unwittingly rubber-stamp.
         *
         * Checked before the approval gate: an escalation attempt should never become a request that
         * exists at all, let alone one a checker might approve.
         */
        if (request.IsAdministrator && !await IsActorAdministratorAsync(actingUserId, ct))
        {
            throw new ForbiddenAppException(
                "Only an administrator can create a role with Platform Administrator Access.");
        }

        await gating.EnsureActorIdentifiedAsync(ApprovalModuleKeys.Roles, actingUserId, ct);

        if (!bypassApproval && actingUserId is not null && await gating.IsGatedAsync(ApprovalModuleKeys.Roles, ct))
        {
            var pending = await gating.SubmitAsync(
                ApprovalModuleKeys.Roles, ApprovalActionKeys.Create, "Role", null, name,
                null, JsonSerializer.Serialize(request), actingUserId.Value, ct,
                // No id yet — dedupe on the natural key this module already enforces as unique (the
                // role name, checked just above). Lowercased so "Manager" and "manager" collide here
                // exactly as they would at creation time.
                entityKey: name.ToLowerInvariant());
            return MutationResult<RoleDetailDto>.PendingApproval(pending);
        }

        var now = DateTimeOffset.UtcNow;
        var role = new Role
        {
            Id = Guid.NewGuid(),
            Name = name,
            Description = request.Description?.Trim(),
            IsSystemRole = false,
            IsAdministrator = request.IsAdministrator,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Roles.Add(role);

        await ApplyPermissionsAsync(role.Id, request.Permissions, ct);
        await db.SaveChangesAsync(ct);

        await WriteAuditAsync(actingUserId, "role.created", role.Id, $"Created role '{role.Name}'", role.Name, ct);

        var permissions = await LoadPermissionsAsync(role.Id, ct);
        return MutationResult<RoleDetailDto>.Ok(ToDetailDto(role, permissions));
    }

    public async Task<MutationResult<RoleDetailDto>> UpdateAsync(
        Guid id, UpsertRoleRequest request, Guid? actingUserId, CancellationToken ct = default, bool bypassApproval = false)
    {
        var role = await db.Roles.FirstOrDefaultAsync(r => r.Id == id, ct) ?? throw NotFound(id);

        var name = request.Name.Trim();
        if (name != role.Name && await db.Roles.AnyAsync(r => r.Name == name && r.Id != id, ct))
        {
            throw new ConflictAppException($"A role named '{name}' already exists.");
        }

        /*
         * Administrator-role lockdown — three separate things, all checked before the approval gate.
         *
         * 1. A non-administrator cannot edit an administrator role at all. Editing one means editing
         *    the permissions of an account that outranks you.
         * 2. Nobody but an administrator can flip the flag in either direction — granting it is the
         *    escalation described in CreateAsync; revoking it is how you'd lock every admin out.
         * 3. A system role's identity is fixed. AuthDbSeeder looks the Super Admin role up BY NAME on
         *    every startup (roles.TryGetValue("Super Admin", …)), so renaming it silently breaks
         *    bootstrap seeding on the next deploy. Permissions on a system role stay editable — only
         *    the name and description are pinned.
         */
        var actorIsAdministrator = await IsActorAdministratorAsync(actingUserId, ct);

        if (role.IsAdministrator && !actorIsAdministrator)
        {
            throw new ForbiddenAppException(
                "Only an administrator can modify a role that has Platform Administrator Access.");
        }

        if (request.IsAdministrator != role.IsAdministrator && !actorIsAdministrator)
        {
            throw new ForbiddenAppException(
                "Only an administrator can grant or revoke Platform Administrator Access.");
        }

        if (role.IsSystemRole && !string.Equals(name, role.Name, StringComparison.Ordinal))
        {
            throw new ConflictAppException(
                $"'{role.Name}' is a built-in role and cannot be renamed. Its permissions can still be edited.");
        }

        await gating.EnsureActorIdentifiedAsync(ApprovalModuleKeys.Roles, actingUserId, ct);

        if (!bypassApproval && actingUserId is not null && await gating.IsGatedAsync(ApprovalModuleKeys.Roles, ct))
        {
            var oldPermissions = await LoadPermissionsAsync(id, ct);
            var oldSnapshot = JsonSerializer.Serialize(new { role.Name, role.Description, role.IsAdministrator, Permissions = oldPermissions });
            var pending = await gating.SubmitAsync(
                ApprovalModuleKeys.Roles, ApprovalActionKeys.Update, "Role", id.ToString(), role.Name,
                oldSnapshot, JsonSerializer.Serialize(request), actingUserId.Value, ct);
            return MutationResult<RoleDetailDto>.PendingApproval(pending);
        }

        role.Name = name;
        role.Description = request.Description?.Trim();
        role.IsAdministrator = request.IsAdministrator;
        role.UpdatedAt = DateTimeOffset.UtcNow;

        await SyncPermissionsAsync(id, request.Permissions, ct);

        await db.SaveChangesAsync(ct);

        await WriteAuditAsync(actingUserId, "role.updated", role.Id, $"Updated role '{role.Name}' — permissions modified", role.Name, ct);

        var permissions = await LoadPermissionsAsync(id, ct);
        return MutationResult<RoleDetailDto>.Ok(ToDetailDto(role, permissions));
    }

    public async Task<ApprovalPendingDto?> DeleteAsync(
        Guid id, Guid? actingUserId, CancellationToken ct = default, bool bypassApproval = false)
    {
        var role = await db.Roles.FirstOrDefaultAsync(r => r.Id == id, ct) ?? throw NotFound(id);

        if (role.IsSystemRole)
        {
            throw new ConflictAppException("Built-in roles cannot be deleted.");
        }

        /*
         * Deleting the role you yourself hold is refused with a message that says so.
         *
         * The generic "still assigned to one or more users" check below would already refuse this, but
         * it reads as though somebody ELSE is in the way — leaving the requester hunting for a user to
         * reassign when the blocker is their own account. Checked first, and before the approval gate,
         * so it never becomes a request a checker has to reject.
         */
        if (actingUserId is not null && role.Id == await db.Users.AsNoTracking()
                .Where(u => u.Id == actingUserId.Value).Select(u => u.RoleId).FirstOrDefaultAsync(ct))
        {
            throw new ForbiddenAppException(
                "You cannot delete the role you are currently assigned to. Move yourself to another role first.");
        }

        var hasUsers = await db.Users.AnyAsync(u => u.RoleId == id, ct);
        if (hasUsers)
        {
            throw new ConflictAppException("This role is still assigned to one or more users and cannot be deleted.");
        }

        await gating.EnsureActorIdentifiedAsync(ApprovalModuleKeys.Roles, actingUserId, ct);

        if (!bypassApproval && actingUserId is not null && await gating.IsGatedAsync(ApprovalModuleKeys.Roles, ct))
        {
            var oldPermissions = await LoadPermissionsAsync(id, ct);
            var oldSnapshot = JsonSerializer.Serialize(new { role.Name, role.Description, role.IsAdministrator, Permissions = oldPermissions });
            return await gating.SubmitAsync(
                ApprovalModuleKeys.Roles, ApprovalActionKeys.Delete, "Role", id.ToString(), role.Name,
                oldSnapshot, "{}", actingUserId.Value, ct);
        }

        var grants = await db.RolePermissions.Where(rp => rp.RoleId == id).ToListAsync(ct);
        db.RolePermissions.RemoveRange(grants);
        db.Roles.Remove(role);
        await db.SaveChangesAsync(ct);

        await WriteAuditAsync(actingUserId, "role.deleted", id, $"Deleted role '{role.Name}'", role.Name, ct);
        return null;
    }

    private async Task WriteAuditAsync(Guid? actingUserId, string action, Guid roleId, string details, string? entityLabel, CancellationToken ct)
    {
        var actorName = actingUserId is null
            ? null
            : await db.Users.AsNoTracking().Where(u => u.Id == actingUserId).Select(u => u.Name).FirstOrDefaultAsync(ct);
        await auditLog.WriteAsync(ServiceName, actingUserId, actorName, action, "Role", roleId.ToString(), details, SourceIp, userAgent: UserAgent, entityLabel: entityLabel, ct: ct);
    }

    /// <summary>
    /// Users assigned to a role. Capped rather than unbounded: this drives a side panel in the Role
    /// editor, and a role with tens of thousands of members would otherwise serialise every one of
    /// them into that panel. The total is returned separately so the UI can say "showing N of M".
    /// </summary>
    public async Task<RoleUsersDto> GetUsersAsync(Guid id, int limit = 50, CancellationToken ct = default)
    {
        if (!await db.Roles.AnyAsync(r => r.Id == id, ct))
        {
            throw NotFound(id);
        }

        var assigned = db.Users.AsNoTracking().Where(u => u.RoleId == id);

        var total = await assigned.CountAsync(ct);
        var users = await assigned
            .OrderBy(u => u.Name)
            .Take(Math.Clamp(limit, 1, 200))
            .Select(u => new RoleUserDto(u.Id, u.Name, u.Email))
            .ToListAsync(ct);

        return new RoleUsersDto(users, total);
    }

    /// <summary>
    /// Brings a role's grants in line with <paramref name="grants"/> by DIFFING, not by deleting every
    /// row and re-inserting.
    ///
    /// The previous approach removed all existing grants and added the new set inside a single
    /// SaveChanges. RolePermissions has a unique index on (RoleId, FeatureId, Capability), and EF Core
    /// does not guarantee that the DELETEs in a batch are ordered before the INSERTs — so re-saving a
    /// role while keeping a permission it already had could hit a unique violation, which surfaced as
    /// an opaque DbUpdateException.
    ///
    /// Diffing removes the collision by construction: a grant that is kept is simply never touched. It
    /// also writes far fewer rows — editing a role's name previously rewrote every one of its
    /// permissions.
    /// </summary>
    private async Task SyncPermissionsAsync(Guid roleId, IReadOnlyList<RolePermissionGrantDto> grants, CancellationToken ct)
    {
        var existing = await db.RolePermissions
            .Include(rp => rp.Feature)
            .Where(rp => rp.RoleId == roleId)
            .ToListAsync(ct);

        // Validate and resolve the requested set first, so an invalid grant aborts before anything is
        // removed — a rejected save must leave the role exactly as it was.
        var resolved = await ResolveGrantsAsync(grants, ct);

        var requested = resolved
            .Select(r => (r.FeatureId, r.Capability))
            .ToHashSet();

        foreach (var row in existing)
        {
            if (!requested.Contains((row.FeatureId, row.Capability)))
            {
                db.RolePermissions.Remove(row);
            }
        }

        var kept = existing
            .Select(r => (r.FeatureId, r.Capability))
            .ToHashSet();

        foreach (var (featureId, capability) in resolved)
        {
            if (!kept.Contains((featureId, capability)))
            {
                db.RolePermissions.Add(new RolePermission
                {
                    Id = Guid.NewGuid(),
                    RoleId = roleId,
                    FeatureId = featureId,
                    Capability = capability,
                });
            }
        }
    }

    /// <summary>
    /// Validates grants against the catalog and resolves them to (FeatureId, Capability) pairs.
    ///
    /// This is where "'remote.employee' does not declare a 'View' capability" comes from, and it is
    /// correct to reject it: a parent feature that delegates everything to its sub-modules declares no
    /// capabilities of its own, so a grant against the PARENT key is meaningless. The UI must offer the
    /// child keys (remote.employee.department) instead.
    /// </summary>
    private async Task<List<(Guid FeatureId, string Capability)>> ResolveGrantsAsync(
        IReadOnlyList<RolePermissionGrantDto> grants, CancellationToken ct)
    {
        var resolved = new List<(Guid, string)>();
        if (grants.Count == 0)
        {
            return resolved;
        }

        var featureKeys = grants.Select(g => g.FeatureKey).Distinct().ToList();
        var features = await db.PermissionFeatures
            .Include(f => f.Capabilities)
            .Where(f => featureKeys.Contains(f.Key) && f.IsActive)
            .ToDictionaryAsync(f => f.Key, ct);

        foreach (var grant in grants.DistinctBy(g => (g.FeatureKey, g.Capability)))
        {
            if (!features.TryGetValue(grant.FeatureKey, out var feature))
            {
                throw new NotFoundAppException($"Permission feature '{grant.FeatureKey}' was not found or is no longer active.");
            }

            if (!feature.Capabilities.Any(c => c.Key == grant.Capability))
            {
                throw new ValidationAppException($"'{feature.Key}' does not declare a '{grant.Capability}' capability.");
            }

            resolved.Add((feature.Id, grant.Capability));
        }

        return resolved;
    }

    private async Task ApplyPermissionsAsync(Guid roleId, IReadOnlyList<RolePermissionGrantDto> grants, CancellationToken ct)
    {
        if (grants.Count == 0)
        {
            return;
        }

        var featureKeys = grants.Select(g => g.FeatureKey).Distinct().ToList();
        var features = await db.PermissionFeatures
            .Include(f => f.Capabilities)
            .Where(f => featureKeys.Contains(f.Key) && f.IsActive)
            .ToDictionaryAsync(f => f.Key, ct);

        foreach (var grant in grants.DistinctBy(g => (g.FeatureKey, g.Capability)))
        {
            if (!features.TryGetValue(grant.FeatureKey, out var feature))
            {
                throw new NotFoundAppException($"Permission feature '{grant.FeatureKey}' was not found or is no longer active.");
            }

            if (!feature.Capabilities.Any(c => c.Key == grant.Capability))
            {
                throw new ValidationAppException($"'{feature.Key}' does not declare a '{grant.Capability}' capability.");
            }

            db.RolePermissions.Add(new RolePermission
            {
                Id = Guid.NewGuid(),
                RoleId = roleId,
                FeatureId = feature.Id,
                Capability = grant.Capability,
            });
        }
    }

    private async Task<IReadOnlyList<RolePermissionGrantDto>> LoadPermissionsAsync(Guid roleId, CancellationToken ct) =>
        await db.RolePermissions
            .AsNoTracking()
            .Include(rp => rp.Feature)
            .Where(rp => rp.RoleId == roleId)
            .Select(rp => new RolePermissionGrantDto(rp.Feature!.Key, rp.Capability))
            .ToListAsync(ct);

    private static RoleDetailDto ToDetailDto(Role r, IReadOnlyList<RolePermissionGrantDto> permissions) => new(
        r.Id, r.Name, r.Description, r.IsSystemRole, r.IsAdministrator, permissions, r.CreatedAt, r.UpdatedAt);

    private static NotFoundAppException NotFound(Guid id) => new($"Role '{id}' was not found.");
}
