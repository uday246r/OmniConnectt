using System.Text.Json;
using AuthService.Application.DTOs;
using AuthService.Application.Exceptions;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Security;
using AuthService.Infrastructure.Validation;
using Microsoft.EntityFrameworkCore;

namespace AuthService.Application.Services;

public class UserAppService(
    AuthDbContext db, PasswordHasher passwordHasher, AuditLogAppService auditLog,
    IHttpContextAccessor httpContextAccessor, ApprovalGatingService gating,
    SetPasswordInviteService invites, FineCapabilityService fineCapabilities,
    UserFieldSchemaAppService fieldSchema, UserSchemaValidator schemaValidator,
    ValidationPresetAppService validationPresets, SalutationAppService salutations)
{
    private const string ServiceName = "AuthService";

    // AuthService writes User audit rows in-process, so the current HttpContext IS the real
    // end-user's own request — no service-to-service hop in between, unlike ModuleRegistry/
    // EmployeeService/LeadService, which have to capture and forward these explicitly.
    private string? SourceIp => httpContextAccessor.HttpContext?.Connection.RemoteIpAddress?.ToString();
    private string? UserAgent => httpContextAccessor.HttpContext?.Request.Headers.UserAgent.ToString();

    /// <summary>
    /// Refuses assigning a role that carries Platform Administrator Access unless the acting user is
    /// themselves an administrator.
    ///
    /// The counterpart to RoleAppService's create/update guards: locking down who can MINT an admin
    /// role is pointless if anyone with Users:Edit can then hand out an existing one. Together the two
    /// close the escalation path completely.
    ///
    /// "Is the actor an administrator" is resolved from the acting user's own DB record rather than
    /// the ambient JWT claim, because during an approval replay the HttpContext belongs to the checker
    /// — see RoleAppService.IsActorAdministratorAsync for the full reasoning.
    /// </summary>
    private async Task EnsureMayAssignRoleAsync(Guid? targetRoleId, Guid? actingUserId, CancellationToken ct)
    {
        if (targetRoleId is null)
        {
            return;
        }

        var targetIsAdministrator = await db.Roles.AsNoTracking()
            .Where(r => r.Id == targetRoleId.Value)
            .Select(r => r.IsAdministrator)
            .FirstOrDefaultAsync(ct);

        if (!targetIsAdministrator)
        {
            return;
        }

        var actorIsAdministrator = actingUserId is not null && await db.Users.AsNoTracking()
            .Where(u => u.Id == actingUserId.Value)
            .Select(u => u.Role != null && u.Role.IsAdministrator)
            .FirstOrDefaultAsync(ct);

        if (!actorIsAdministrator)
        {
            throw new ForbiddenAppException(
                "Only an administrator can assign a role that has Platform Administrator Access.");
        }
    }

    public async Task<PagedResult<UserListItemDto>> ListAsync(
        int page, int pageSize, string? search, bool? isActive, Guid? roleId, CancellationToken ct = default)
    {
        var query = db.Users.Include(u => u.Role).AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLowerInvariant();
            query = query.Where(u =>
                u.Name.ToLower().Contains(term) ||
                u.Email.ToLower().Contains(term) ||
                (u.PhoneNumber != null && u.PhoneNumber.Contains(term)));
        }

        if (isActive is not null)
        {
            var status = isActive.Value ? UserStatus.Active : UserStatus.Inactive;
            query = query.Where(u => u.Status == status);
        }

        if (roleId is not null)
        {
            query = query.Where(u => u.RoleId == roleId);
        }

        var total = await query.CountAsync(ct);
        var items = await query
            .OrderBy(u => u.Status)
            .ThenBy(u => u.Name)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(u => ToListItemDto(u))
            .ToListAsync(ct);

        return new PagedResult<UserListItemDto>(items, total, page, pageSize);
    }

    public async Task<UserDetailDto> GetAsync(Guid id, CancellationToken ct = default)
    {
        var user = await FindWithRoleAsync(id, ct) ?? throw NotFound(id);
        var overrides = await LoadOverridesAsync(id, ct);
        return ToDetailDto(user, overrides);
    }

    public async Task<MutationResult<CreateUserResponse>> CreateAsync(
        CreateUserRequest request, IReadOnlyList<PermissionOverrideDto>? overrides, Guid? actingUserId,
        CancellationToken ct = default, bool bypassApproval = false)
    {
        var email = request.Email.Trim().ToLowerInvariant();
        if (await db.Users.AnyAsync(u => u.Email == email, ct))
        {
            throw new ConflictAppException($"A user with email '{email}' already exists.");
        }

        if (request.RoleId is not null && !await db.Roles.AnyAsync(r => r.Id == request.RoleId, ct))
        {
            throw new NotFoundAppException($"Role '{request.RoleId}' was not found.");
        }

        if (!Enum.TryParse<Domain.Enums.AuthProvider>(request.AuthProvider, out var authProvider))
        {
            throw new ValidationAppException($"Unknown authentication provider '{request.AuthProvider}'.");
        }

        // Re-validates Name/Email/PhoneNumber against any extra rules an admin has layered onto them
        // via UserFieldSchema, and every custom field — must happen before the Maker-Checker gate below
        // (a request doomed to fail must never be submitted for approval), same reasoning as every
        // other check above it.
        var extraAttributesJson = await ValidateAndBuildExtraAttributesAsync(
            request.Name.Trim(), email, request.PhoneNumber?.Trim(), request.CustomFields, ct);
        var salutation = await ValidateSalutationAsync(request.Salutation, ct);

        await EnsureMayAssignRoleAsync(request.RoleId, actingUserId, ct);

        /*
         * Maker-Checker gate. Runs AFTER every validation above (a request doomed to fail must never
         * be submitted for approval) but BEFORE anything is actually created. bypassApproval:true is
         * set only by ApprovalAppService.ApproveAsync when REPLAYING an already-approved request
         * through this same method — never by an ordinary caller — which is also why re-running these
         * exact validations at replay time is deliberate: it correctly surfaces "someone else took
         * this email while the request was pending" as a real error instead of silently corrupting
         * data.
         */
        await gating.EnsureActorIdentifiedAsync(ApprovalModuleKeys.Users, actingUserId, ct);

        if (!bypassApproval && actingUserId is not null && await gating.IsGatedAsync(ApprovalModuleKeys.Users, ct))
        {
            var newRoleName = request.RoleId is null
                ? null
                : await db.Roles.AsNoTracking().Where(r => r.Id == request.RoleId).Select(r => r.Name).FirstOrDefaultAsync(ct);
            var newSnapshot = new UserSnapshotDto(
                request.Name.Trim(), email, request.PhoneNumber?.Trim(), request.RoleId, newRoleName,
                request.IsActive, overrides, request.AuthProvider, request.CustomFields, salutation);
            var pending = await gating.SubmitAsync(
                ApprovalModuleKeys.Users, ApprovalActionKeys.Create, "User", null, request.Name.Trim(),
                null, JsonSerializer.Serialize(newSnapshot), actingUserId.Value, ct,
                // No id exists yet, so the dedupe key is the natural key this module already enforces
                // as unique — the normalized email checked a few lines above. Stops two makers both
                // queueing "create foo@bar", where the second would otherwise fail at approval time
                // with a confusing duplicate-email error the checker can do nothing about.
                entityKey: email);
            return MutationResult<CreateUserResponse>.PendingApproval(pending);
        }

        var now = DateTimeOffset.UtcNow;
        var isLocal = authProvider == Domain.Enums.AuthProvider.Local;

        var user = new User
        {
            Id = Guid.NewGuid(),
            Salutation = salutation,
            Name = request.Name.Trim(),
            Email = email,
            PhoneNumber = request.PhoneNumber?.Trim(),
            ExtraAttributes = extraAttributesJson,
            AuthProvider = authProvider,
            Status = request.IsActive ? UserStatus.Active : UserStatus.Inactive,
            RoleId = request.RoleId,
            // Google accounts have no local password to force a change on — MustChangePassword only
            // applies to the Local flow's system-generated temporary password.
            MustChangePassword = isLocal,
            CreatedAt = now,
            UpdatedAt = now,
            CreatedBy = actingUserId,
            UpdatedBy = actingUserId,
        };

        // Local: generate + hash a real one-time temp password, returned once to the caller.
        // Google: PasswordHash stays null — this account can never sign in with a local password,
        // see AuthAppService.LoginAsync's null-guard.
        string? tempPassword = null;
        if (isLocal)
        {
            tempPassword = TemporaryPasswordGenerator.Generate();
            user.PasswordHash = passwordHasher.Hash(user, tempPassword);
        }

        db.Users.Add(user);
        await db.SaveChangesAsync(ct);

        // Bundled from the same submission that created this account — see
        // CreateUserWithOverridesRequest's doc comment for why this can't be a separate follow-up call
        // the way it used to be.
        if (overrides is { Count: > 0 })
        {
            await ApplyOverridesAsync(user.Id, overrides, actingUserId, ct);
        }

        var saved = await FindWithRoleAsync(user.Id, ct) ?? throw NotFound(user.Id);
        var savedOverrides = await LoadOverridesAsync(user.Id, ct);

        /*
         * Invite the new user to choose their own password.
         *
         * Best-effort by design: IssueAsync returns false rather than throwing when SMTP is
         * unconfigured or delivery fails, because the account already exists by this point and a mail
         * problem must not undo it. The encrypted temporary password above stays available in every
         * case, retrievable by the maker from My Requests — the two mechanisms coexist rather than
         * one replacing the other.
         *
         * Local accounts only: a Google-provisioned account has no local password to set.
         */
        var inviteEmailed = false;
        if (isLocal)
        {
            inviteEmailed = await invites.IssueAsync(saved, actingUserId, ct);
            await db.SaveChangesAsync(ct);
        }

        var actorName = await ResolveActorNameAsync(actingUserId, ct);
        var auditDetail = inviteEmailed
            ? $"Created {user.Email} (set-password invite emailed)"
            : $"Created {user.Email}";
        await auditLog.WriteAsync(ServiceName, actingUserId, actorName, "user.created", "User", user.Id.ToString(), auditDetail, SourceIp, userAgent: UserAgent, entityLabel: user.Name, ct: ct);

        return MutationResult<CreateUserResponse>.Ok(new CreateUserResponse(ToDetailDto(saved, savedOverrides), tempPassword, inviteEmailed));
    }

    public async Task<MutationResult<UserDetailDto>> UpdateAsync(
        Guid id, UpdateUserRequest request, IReadOnlyList<PermissionOverrideDto>? overrides, Guid? actingUserId,
        CancellationToken ct = default, bool bypassApproval = false)
    {
        var user = await FindWithRoleAsync(id, ct) ?? throw NotFound(id);

        var email = request.Email.Trim().ToLowerInvariant();
        if (email != user.Email && await db.Users.AnyAsync(u => u.Email == email && u.Id != id, ct))
        {
            throw new ConflictAppException($"A user with email '{email}' already exists.");
        }

        if (request.RoleId is not null && !await db.Roles.AnyAsync(r => r.Id == request.RoleId, ct))
        {
            throw new NotFoundAppException($"Role '{request.RoleId}' was not found.");
        }

        // Only guard an actual CHANGE of role — re-saving a user who already holds an administrator
        // role (e.g. a non-admin editing their phone number) must not be refused.
        if (request.RoleId != user.RoleId)
        {
            await EnsureMayAssignRoleAsync(request.RoleId, actingUserId, ct);
        }

        /*
         * Self-protection, checked BEFORE the approval gate so it is refused outright rather than
         * queued for a checker to reject — there is no legitimate version of these requests, so making
         * someone review one is pure noise.
         *
         * Editing your own name/email/phone stays allowed; only the two genuinely self-destructive
         * changes are blocked. Deactivating yourself locks you out immediately, and changing your own
         * role is the classic privilege-escalation shape (grant yourself a bigger role, or strip your
         * own role and lose access with nobody able to notice you did it).
         *
         * Deliberately NOT conditioned on bypassApproval: a replay carries actingUserId = MakerId, so
         * this doubles as defense in depth for anything that somehow got queued before this shipped.
         */
        if (actingUserId is not null && id == actingUserId.Value)
        {
            if (!request.IsActive)
            {
                throw new ForbiddenAppException(
                    "You cannot deactivate your own account. Ask another administrator to do it.");
            }

            if (request.RoleId != user.RoleId)
            {
                throw new ForbiddenAppException(
                    "You cannot change your own role. Ask another administrator to do it.");
            }
        }

        // Re-validates Name/Email/PhoneNumber against any extra rules an admin has layered onto them
        // via UserFieldSchema, and every custom field — must happen before the Maker-Checker gate
        // below, same reasoning as CreateAsync.
        //
        // CustomFields is nullable, distinct from an empty dictionary, the same way Overrides is
        // elsewhere in this file: null means this submission never touched custom fields at all (e.g.
        // ProfilePage's self-service edit, which has no custom-field UI) and the existing values must
        // survive untouched; an explicit dictionary — even {} — is the full replacement set. Collapsing
        // "didn't touch custom fields" to "wipe them" would silently erase e.g. Aadhar Number the first
        // time a user edited their own name from Profile.
        var customFieldsForValidation = request.CustomFields ?? DeserializeExtraAttributes(user.ExtraAttributes);
        var extraAttributesJson = await ValidateAndBuildExtraAttributesAsync(
            request.Name.Trim(), email, request.PhoneNumber?.Trim(), customFieldsForValidation, ct);
        var salutation = await ValidateSalutationAsync(request.Salutation, ct);

        await gating.EnsureActorIdentifiedAsync(ApprovalModuleKeys.Users, actingUserId, ct);

        if (!bypassApproval && actingUserId is not null && await gating.IsGatedAsync(ApprovalModuleKeys.Users, ct))
        {
            var existingOverrides = await LoadOverridesAsync(id, ct);
            var oldSnapshot = new UserSnapshotDto(
                user.Name, user.Email, user.PhoneNumber, user.RoleId, user.Role?.Name,
                user.Status == UserStatus.Active, existingOverrides,
                CustomFields: DeserializeExtraAttributes(user.ExtraAttributes), Salutation: user.Salutation);
            var newRoleName = request.RoleId is null
                ? null
                : await db.Roles.AsNoTracking().Where(r => r.Id == request.RoleId).Select(r => r.Name).FirstOrDefaultAsync(ct);
            var newSnapshot = new UserSnapshotDto(
                request.Name.Trim(), email, request.PhoneNumber?.Trim(), request.RoleId, newRoleName,
                request.IsActive, overrides, CustomFields: customFieldsForValidation, Salutation: salutation);
            var pending = await gating.SubmitAsync(
                ApprovalModuleKeys.Users, ApprovalActionKeys.Update, "User", id.ToString(), user.Name,
                JsonSerializer.Serialize(oldSnapshot), JsonSerializer.Serialize(newSnapshot), actingUserId.Value, ct);
            return MutationResult<UserDetailDto>.PendingApproval(pending);
        }

        user.Salutation = salutation;
        user.Name = request.Name.Trim();
        user.Email = email;
        user.PhoneNumber = request.PhoneNumber?.Trim();
        user.ExtraAttributes = extraAttributesJson;
        user.RoleId = request.RoleId;

        /*
         * Account status is part of the update.
         *
         * UpdateUserRequest previously had no IsActive field at all, so the "Account is Active" toggle
         * in the edit form had nothing to save into — it moved, the form saved, and the status silently
         * did not change. Status is now edited in one place (the user form) rather than from a list row,
         * so this is the only path that sets it apart from the dedicated status endpoint.
         *
         * A status change is recorded as its own audit action. "user.updated" does not convey that
         * someone's ability to sign in was revoked, and that is exactly the event an auditor looks for.
         */
        var previousStatus = user.Status;
        var requestedStatus = request.IsActive ? UserStatus.Active : UserStatus.Inactive;
        var statusChanged = previousStatus != requestedStatus;
        user.Status = requestedStatus;

        user.UpdatedAt = DateTimeOffset.UtcNow;
        user.UpdatedBy = actingUserId;

        await db.SaveChangesAsync(ct);

        // This edit can move the user to a different role, which changes every capability they inherit
        // — so it counts even though no permission row was touched here.
        fineCapabilities.Invalidate(user.Id);

        // Bundled from the same submission as the core-field edit — see UpdateUserWithOverridesRequest's
        // doc comment. Applied AFTER the core fields commit, same ordering the ungated path always used
        // when this was two separate calls.
        if (overrides is not null)
        {
            await ApplyOverridesAsync(id, overrides, actingUserId, ct);
        }

        var actorName = await ResolveActorNameAsync(actingUserId, ct);
        await auditLog.WriteAsync(ServiceName, actingUserId, actorName, "user.updated", "User", user.Id.ToString(), $"Updated {user.Email}", SourceIp, userAgent: UserAgent, entityLabel: user.Name, ct: ct);

        if (statusChanged)
        {
            await auditLog.WriteAsync(
                ServiceName, actingUserId, actorName,
                request.IsActive ? "user.activated" : "user.deactivated",
                "User", user.Id.ToString(),
                $"{user.Email} was {(request.IsActive ? "activated" : "deactivated")}.", SourceIp, userAgent: UserAgent, entityLabel: user.Name, ct: ct);
        }

        var savedOverrides = await LoadOverridesAsync(id, ct);
        return MutationResult<UserDetailDto>.Ok(ToDetailDto(user, savedOverrides));
    }

    public async Task<MutationResult<UserDetailDto>> UpdateStatusAsync(
        Guid id, bool isActive, Guid? actingUserId, CancellationToken ct = default, bool bypassApproval = false)
    {
        var user = await FindWithRoleAsync(id, ct) ?? throw NotFound(id);

        // See UpdateAsync for the full rationale. Refused before the gate so it never reaches a checker.
        if (!isActive && actingUserId is not null && id == actingUserId.Value)
        {
            throw new ForbiddenAppException(
                "You cannot deactivate your own account. Ask another administrator to do it.");
        }

        await gating.EnsureActorIdentifiedAsync(ApprovalModuleKeys.Users, actingUserId, ct);

        if (!bypassApproval && actingUserId is not null && await gating.IsGatedAsync(ApprovalModuleKeys.Users, ct))
        {
            var oldSnapshot = JsonSerializer.Serialize(new { IsActive = user.Status == UserStatus.Active });
            var pending = await gating.SubmitAsync(
                ApprovalModuleKeys.Users, isActive ? ApprovalActionKeys.Enable : ApprovalActionKeys.Disable,
                "User", id.ToString(), user.Name, oldSnapshot,
                JsonSerializer.Serialize(new UpdateUserStatusRequest(isActive)), actingUserId.Value, ct);
            return MutationResult<UserDetailDto>.PendingApproval(pending);
        }

        // Deactivating a checker must not strand the requests waiting on them. Runs on the APPLY path
        // (after the gate) so the reassignment happens when the change actually takes effect, and
        // commits in the same SaveChanges below — never half-applied.
        if (!isActive)
        {
            await gating.ReassignPendingRequestsForDepartingCheckerAsync(
                id, actingUserId, "their account was deactivated", ct);
        }

        user.Status = isActive ? UserStatus.Active : UserStatus.Inactive;
        user.UpdatedAt = DateTimeOffset.UtcNow;
        user.UpdatedBy = actingUserId;
        await db.SaveChangesAsync(ct);

        var actorName = await ResolveActorNameAsync(actingUserId, ct);
        await auditLog.WriteAsync(ServiceName, actingUserId, actorName, isActive ? "user.activated" : "user.deactivated", "User", user.Id.ToString(), $"{(isActive ? "Activated" : "Deactivated")} {user.Email}", SourceIp, userAgent: UserAgent, entityLabel: user.Name, ct: ct);

        var overrides = await LoadOverridesAsync(id, ct);
        return MutationResult<UserDetailDto>.Ok(ToDetailDto(user, overrides));
    }

    public async Task<ApprovalPendingDto?> DeleteAsync(
        Guid id, Guid? actingUserId, CancellationToken ct = default, bool bypassApproval = false)
    {
        var user = await FindWithRoleAsync(id, ct) ?? throw NotFound(id);

        // See UpdateAsync for the full rationale. Refused before the gate so it never reaches a checker.
        if (actingUserId is not null && id == actingUserId.Value)
        {
            throw new ForbiddenAppException(
                "You cannot delete your own account. Ask another administrator to do it.");
        }

        await gating.EnsureActorIdentifiedAsync(ApprovalModuleKeys.Users, actingUserId, ct);

        if (!bypassApproval && actingUserId is not null && await gating.IsGatedAsync(ApprovalModuleKeys.Users, ct))
        {
            var existingOverrides = await LoadOverridesAsync(id, ct);
            var oldSnapshot = new UserSnapshotDto(
                user.Name, user.Email, user.PhoneNumber, user.RoleId, user.Role?.Name,
                user.Status == UserStatus.Active, existingOverrides);
            return await gating.SubmitAsync(
                ApprovalModuleKeys.Users, ApprovalActionKeys.Delete, "User", id.ToString(), user.Name,
                JsonSerializer.Serialize(oldSnapshot), "{}", actingUserId.Value, ct);
        }

        // Same reasoning as deactivation — a deleted checker can no longer act on anything assigned to
        // them, so their queue has to move before the deletion commits.
        await gating.ReassignPendingRequestsForDepartingCheckerAsync(
            id, actingUserId, "their account was deleted", ct);

        user.IsDeleted = true;
        user.Status = UserStatus.Inactive;
        user.UpdatedAt = DateTimeOffset.UtcNow;
        user.UpdatedBy = actingUserId;
        await db.SaveChangesAsync(ct);

        var actorName = await ResolveActorNameAsync(actingUserId, ct);
        await auditLog.WriteAsync(ServiceName, actingUserId, actorName, "user.deleted", "User", user.Id.ToString(), $"Deleted {user.Email}", SourceIp, userAgent: UserAgent, entityLabel: user.Name, ct: ct);
        return null;
    }

    private async Task<string?> ResolveActorNameAsync(Guid? actingUserId, CancellationToken ct)
    {
        if (actingUserId is null) return null;
        return await db.Users.AsNoTracking().Where(u => u.Id == actingUserId).Select(u => u.Name).FirstOrDefaultAsync(ct);
    }

    public async Task<IReadOnlyList<PermissionOverrideDto>> GetPermissionOverridesAsync(Guid userId, CancellationToken ct = default)
    {
        if (!await db.Users.AnyAsync(u => u.Id == userId, ct))
        {
            throw NotFound(userId);
        }

        return await LoadOverridesAsync(userId, ct);
    }

    /// <summary>
    /// The gated, controller-facing entry point for the standalone permission-overrides endpoint.
    /// Previously this was a completely open side door around Users gating — a caller who skipped the
    /// bundled Update flow (e.g. a direct API call) applied permission changes immediately regardless of
    /// whether the Users module had a checker assigned. Now it's gated exactly like every other Users
    /// mutation, replaying through the same ApplyOverridesAsync a bundled Update's replay uses.
    /// </summary>
    public async Task<MutationResult<IReadOnlyList<PermissionOverrideDto>>> ReplacePermissionOverridesAsync(
        Guid userId, IReadOnlyList<PermissionOverrideDto> overrides, Guid? actingUserId, CancellationToken ct = default, bool bypassApproval = false)
    {
        var user = await FindWithRoleAsync(userId, ct) ?? throw NotFound(userId);

        await gating.EnsureActorIdentifiedAsync(ApprovalModuleKeys.Users, actingUserId, ct);

        if (!bypassApproval && actingUserId is not null && await gating.IsGatedAsync(ApprovalModuleKeys.Users, ct))
        {
            var existingOverrides = await LoadOverridesAsync(userId, ct);
            // Core fields are identical on both sides here — only Overrides differs — so the diff view
            // naturally shows "no field changes, only permission changes" with zero special-casing.
            // EntityType "UserPermissionOverrides" (not "User") is how ApprovalAppService.ReplayAsync
            // tells this origin apart from a bundled Update within the same (Users, Update) case.
            var oldSnapshot = new UserSnapshotDto(
                user.Name, user.Email, user.PhoneNumber, user.RoleId, user.Role?.Name,
                user.Status == UserStatus.Active, existingOverrides);
            var newSnapshot = oldSnapshot with { Overrides = overrides };
            var pending = await gating.SubmitAsync(
                ApprovalModuleKeys.Users, ApprovalActionKeys.Update, "UserPermissionOverrides", userId.ToString(), user.Name,
                JsonSerializer.Serialize(oldSnapshot), JsonSerializer.Serialize(newSnapshot), actingUserId.Value, ct);
            return MutationResult<IReadOnlyList<PermissionOverrideDto>>.PendingApproval(pending);
        }

        var applied = await ApplyOverridesAsync(userId, overrides, actingUserId, ct);
        return MutationResult<IReadOnlyList<PermissionOverrideDto>>.Ok(applied);
    }

    /// <summary>The actual override-diff-and-save logic, used by the direct/replay paths of both the
    /// bundled Update flow and the standalone permission-overrides endpoint. No gating here — callers
    /// are responsible for deciding whether this specific invocation should have been gated.</summary>
    internal async Task<IReadOnlyList<PermissionOverrideDto>> ApplyOverridesAsync(
        Guid userId, IReadOnlyList<PermissionOverrideDto> overrides, Guid? actingUserId, CancellationToken ct = default)
    {
        if (!await db.Users.AnyAsync(u => u.Id == userId, ct))
        {
            throw NotFound(userId);
        }

        var existing = await db.UserPermissionOverrides.Where(o => o.UserId == userId).ToListAsync(ct);

        /*
         * Validate and resolve EVERYTHING before removing anything.
         *
         * The previous version removed all existing overrides first, then validated each incoming one
         * inside the same loop that added it. So a request containing a single invalid grant — which is
         * exactly what the UI was sending with `remote.employee:View` — threw partway through, after
         * the removals were already tracked. The exception rolled the transaction back, but the
         * ordering was only accidentally safe; a rejected save must never be able to leave a user with
         * fewer permissions than they started with.
         *
         * It also removed and re-inserted rows that had not changed. UserPermissionOverrides has a
         * unique index on (UserId, FeatureId, Capability) and EF does not guarantee DELETEs are
         * batched before INSERTs, so re-saving a user while keeping an override they already had could
         * hit a unique violation. Diffing avoids both problems.
         */
        var featureKeys = overrides.Select(o => o.FeatureKey).Distinct().ToList();
        var features = await db.PermissionFeatures
            .Include(f => f.Capabilities)
            .Where(f => featureKeys.Contains(f.Key))
            .ToDictionaryAsync(f => f.Key, ct);

        var resolved = new List<(Guid FeatureId, string Capability, PermissionEffect Effect)>();
        foreach (var o in overrides.DistinctBy(o => (o.FeatureKey, o.Capability)))
        {
            if (!features.TryGetValue(o.FeatureKey, out var feature))
            {
                throw new NotFoundAppException($"Permission feature '{o.FeatureKey}' was not found.");
            }

            if (!feature.Capabilities.Any(c => c.Key == o.Capability))
            {
                throw new ValidationAppException($"'{feature.Key}' does not declare a '{o.Capability}' capability.");
            }

            if (!Enum.TryParse<PermissionEffect>(o.Effect, out var effect))
            {
                throw new ValidationAppException($"Unknown effect '{o.Effect}'.");
            }

            resolved.Add((feature.Id, o.Capability, effect));
        }

        var now = DateTimeOffset.UtcNow;
        var requested = resolved.ToDictionary(r => (r.FeatureId, r.Capability), r => r.Effect);

        foreach (var row in existing)
        {
            if (requested.TryGetValue((row.FeatureId, row.Capability), out var effect))
            {
                // Kept. Update the effect in place if it flipped between Grant and Revoke, rather than
                // deleting and re-adding the same unique key.
                if (row.Effect != effect)
                {
                    row.Effect = effect;
                }
            }
            else
            {
                db.UserPermissionOverrides.Remove(row);
            }
        }

        var kept = existing.Select(r => (r.FeatureId, r.Capability)).ToHashSet();
        foreach (var (featureId, capability, effect) in resolved)
        {
            if (kept.Contains((featureId, capability)))
            {
                continue;
            }

            db.UserPermissionOverrides.Add(new UserPermissionOverride
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                FeatureId = featureId,
                Capability = capability,
                Effect = effect,
                CreatedAt = now,
                CreatedBy = actingUserId,
            });
        }

        await db.SaveChangesAsync(ct);

        // This user's overrides changed and nobody else's did, so the targeted eviction is enough.
        fineCapabilities.Invalidate(userId);

        return await LoadOverridesAsync(userId, ct);
    }

    /// <summary>
    /// Validates request.Name/Email/PhoneNumber against any EXTRA rules the admin has layered onto
    /// those core fields via UserFieldSchema (on top of the fixed required/max-length floor the DTO's
    /// data annotations already enforce), validates every submitted custom field, and returns the
    /// filtered custom-field JSON to store in User.ExtraAttributes. A key in <paramref name="customFields"/>
    /// that isn't a currently-defined, non-core field is silently dropped rather than stored — an admin
    /// removing a custom field from the schema must not resurrect it the next time someone edits an
    /// unrelated user whose form still had the old value cached.
    /// </summary>
    private async Task<string?> ValidateAndBuildExtraAttributesAsync(
        string name, string email, string? phoneNumber,
        IReadOnlyDictionary<string, string>? customFields, CancellationToken ct)
    {
        var fields = await fieldSchema.GetFieldsAsync(ct);
        var customPresets = await validationPresets.GetPresetsAsync(ct);

        var values = new Dictionary<string, string?>
        {
            ["name"] = name,
            ["email"] = email,
            ["phoneNumber"] = phoneNumber,
        };

        var allowedCustomKeys = fields.Where(f => !f.Core).Select(f => f.Key).ToHashSet();
        var extraAttributes = new Dictionary<string, string>();
        if (customFields is not null)
        {
            foreach (var (key, value) in customFields)
            {
                if (!allowedCustomKeys.Contains(key))
                {
                    continue;
                }

                values[key] = value;
                if (!string.IsNullOrWhiteSpace(value))
                {
                    extraAttributes[key] = value.Trim();
                }
            }
        }

        var errors = schemaValidator.Validate(fields, values, customPresets);
        if (errors.Count > 0)
        {
            throw new FieldValidationException(errors);
        }

        return extraAttributes.Count > 0 ? JsonSerializer.Serialize(extraAttributes) : null;
    }

    /// <summary>Null/empty is always fine (Salutation is optional); a non-empty value must match one of
    /// the admin-configured SalutationCatalog entries — a stray value from a stale client must not be
    /// able to introduce a title the catalog no longer offers.</summary>
    private async Task<string?> ValidateSalutationAsync(string? salutation, CancellationToken ct)
    {
        var trimmed = salutation?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        var allowed = await salutations.GetSalutationsAsync(ct);
        if (!allowed.Contains(trimmed, StringComparer.Ordinal))
        {
            throw new ValidationAppException($"'{trimmed}' is not a recognised salutation.");
        }

        return trimmed;
    }

    private static IReadOnlyDictionary<string, string>? DeserializeExtraAttributes(string? json) =>
        string.IsNullOrEmpty(json) ? null : JsonSerializer.Deserialize<Dictionary<string, string>>(json);

    private Task<User?> FindWithRoleAsync(Guid id, CancellationToken ct) =>
        db.Users.Include(u => u.Role).FirstOrDefaultAsync(u => u.Id == id, ct);

    private async Task<IReadOnlyList<PermissionOverrideDto>> LoadOverridesAsync(Guid userId, CancellationToken ct) =>
        await db.UserPermissionOverrides
            .AsNoTracking()
            .Include(o => o.Feature)
            .Where(o => o.UserId == userId)
            .Select(o => new PermissionOverrideDto(o.Feature!.Key, o.Capability, o.Effect.ToString()))
            .ToListAsync(ct);

    private static UserListItemDto ToListItemDto(User u) => new(
        u.Id, u.Salutation, u.Name, u.Email, u.PhoneNumber, u.RoleId, u.Role?.Name,
        u.Role != null && u.Role.IsAdministrator, u.Status == UserStatus.Active, u.LastLoginAt, u.AuthProvider.ToString());

    private static UserDetailDto ToDetailDto(User u, IReadOnlyList<PermissionOverrideDto> overrides) => new(
        u.Id, u.Salutation, u.Name, u.Email, u.PhoneNumber, u.RoleId, u.Role?.Name,
        u.Role != null && u.Role.IsAdministrator, u.Status == UserStatus.Active, u.MustChangePassword,
        u.LastLoginAt, u.CreatedAt, u.UpdatedAt, overrides, u.AuthProvider.ToString(),
        DeserializeExtraAttributes(u.ExtraAttributes));

    private static NotFoundAppException NotFound(Guid id) => new($"User '{id}' was not found.");
}
