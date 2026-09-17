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
    // end-user's own request — no service-to-service hop in between, unlike LeadService/
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

    public Task<PagedResult<UserListItemDto>> ListAsync(
        int page, int pageSize, string? search, bool? isActive, Guid? roleId, CancellationToken ct = default) =>
        ListAsync(page, pageSize, new UserListFilter { Search = search, IsActive = isActive, RoleId = roleId }, ct);

    /// <summary>One page of the directory, every filter applied in the database — see <see cref="UserListFilter"/>.</summary>
    public async Task<PagedResult<UserListItemDto>> ListAsync(
        int page, int pageSize, UserListFilter filter, CancellationToken ct = default)
    {
        var query = ApplyFilter(db.Users.Include(u => u.Role).AsNoTracking(), filter);

        var total = await query.CountAsync(ct);
        var items = await query
            .OrderBy(u => u.Status)
            .ThenBy(u => u.Name)
            // Two people can share a name; without a unique tiebreaker a row could appear on two pages or none.
            .ThenBy(u => u.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(u => ToListItemDto(u))
            .ToListAsync(ct);

        return new PagedResult<UserListItemDto>(await MarkAwaitingSetupAsync(items, ct), total, page, pageSize);
    }

    /// <summary>Headline counts for the whole directory, computed by the database.</summary>
    public async Task<UserDirectorySummaryDto> SummaryAsync(CancellationToken ct = default)
    {
        // One statement: every figure the cards show, counted with a filter each. These were three
        // sequential queries, one round trip apiece. The role flag is projected before grouping so the
        // aggregate never has to follow a navigation property.
        var counts = await db.Users.AsNoTracking()
            .Select(u => new { Active = u.Status == UserStatus.Active, Administrator = u.Role != null && u.Role.IsAdministrator })
            .GroupBy(_ => 1)
            .Select(g => new
            {
                Total = g.Count(),
                Active = g.Count(u => u.Active),
                Administrators = g.Count(u => u.Administrator),
            })
            .FirstOrDefaultAsync(ct);

        var total = counts?.Total ?? 0;
        var active = counts?.Active ?? 0;
        return new UserDirectorySummaryDto(total, active, total - active, counts?.Administrators ?? 0);
    }

    /// <summary>The roles the Role filter can offer, under the other filters applied.</summary>
    public async Task<UserListFacetsDto> FacetsAsync(UserListFilter filter, CancellationToken ct = default)
    {
        var scoped = ApplyFilter(db.Users.AsNoTracking(), filter with { Role = null, RoleId = null });

        var roleNames = await scoped.Where(u => u.Role != null).Select(u => u.Role!.Name).Distinct().OrderBy(n => n).Take(200).ToListAsync(ct);
        var anyWithoutRole = await scoped.AnyAsync(u => u.RoleId == null, ct);

        return new UserListFacetsDto(anyWithoutRole ? [.. roleNames, NoRoleLabel] : roleNames);
    }

    /// <summary>How the list labels a user with no role. The Role filter accepts it as a value.</summary>
    public const string NoRoleLabel = "No Role";

    private static IQueryable<User> ApplyFilter(IQueryable<User> query, UserListFilter filter)
    {
        if (!string.IsNullOrWhiteSpace(filter.Search))
        {
            var term = filter.Search.Trim().ToLowerInvariant();
            var digits = new string(term.Where(char.IsAsciiDigit).ToArray());
            query = query.Where(u =>
                u.Name.ToLower().Contains(term) ||
                u.Email.ToLower().Contains(term) ||
                (u.Role != null && u.Role.Name.ToLower().Contains(term)) ||
                (digits.Length > 0 && u.PhoneNumber != null &&
                 System.Text.RegularExpressions.Regex.Replace(u.PhoneNumber, "[^0-9]", "").Contains(digits)));
        }

        if (!string.IsNullOrWhiteSpace(filter.Name))
        {
            var name = filter.Name.Trim().ToLowerInvariant();
            query = query.Where(u => u.Name.ToLower().Contains(name) || u.Email.ToLower().Contains(name));
        }

        if (!string.IsNullOrWhiteSpace(filter.Phone))
        {
            // Stored numbers carry formatting the operator won't type — compare digits only, in the database.
            var digits = new string(filter.Phone.Where(char.IsAsciiDigit).ToArray());
            if (digits.Length > 0)
            {
                query = query.Where(u => u.PhoneNumber != null &&
                    System.Text.RegularExpressions.Regex.Replace(u.PhoneNumber, "[^0-9]", "").Contains(digits));
            }
        }

        if (!string.IsNullOrWhiteSpace(filter.Role))
        {
            var role = filter.Role.Trim();
            query = string.Equals(role, NoRoleLabel, StringComparison.OrdinalIgnoreCase)
                ? query.Where(u => u.RoleId == null)
                : query.Where(u => u.Role != null && u.Role.Name == role);
        }

        if (filter.RoleId is not null)
        {
            query = query.Where(u => u.RoleId == filter.RoleId);
        }

        if (filter.IsActive is not null)
        {
            var status = filter.IsActive.Value ? UserStatus.Active : UserStatus.Inactive;
            query = query.Where(u => u.Status == status);
        }

        if (filter.LastLoginFrom is not null)
        {
            query = query.Where(u => u.LastLoginAt != null && u.LastLoginAt >= filter.LastLoginFrom);
        }

        if (filter.LastLoginTo is not null)
        {
            query = query.Where(u => u.LastLoginAt != null && u.LastLoginAt <= filter.LastLoginTo);
        }

        return query;
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

        // Local: hash a random value nobody ever sees, so the row is never "no password set" — only
        // the invite link below can turn this account into a usable login. The generated value is
        // deliberately discarded rather than returned: credentials never travel back to the caller.
        // Google: PasswordHash stays null — this account can never sign in with a local password,
        // see AuthAppService.LoginAsync's null-guard.
        if (isLocal)
        {
            user.PasswordHash = passwordHasher.Hash(user, TemporaryPasswordGenerator.Generate());
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
         * problem must not undo it. A false here is reported to the caller as InviteEmailed = false so
         * the maker knows the account cannot be logged into yet, and an administrator can retry with
         * POST /api/users/{id}/resend-invite once mail is working.
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
        await auditLog.WriteHostAsync(
            actingUserId, actorName, "user.created",
            AuditLogAppService.Modules.Users, AuditLogAppService.Categories.Crud,
            entityType: "User", entityId: user.Id.ToString(), details: auditDetail,
            entityLabel: user.Name, sourceIp: SourceIp, userAgent: UserAgent, ct: ct);

        return MutationResult<CreateUserResponse>.Ok(new CreateUserResponse(ToDetailDto(saved, savedOverrides), inviteEmailed));
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
        var salutation = await ValidateSalutationAsync(request.Salutation, ct, currentValue: user.Salutation);

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

        /*
         * Captured before the assignments below, so the audit row can say WHAT changed.
         *
         * "Updated alice@example.com" was the entire record of an edit. It could not distinguish a
         * corrected phone number from a move onto the administrator role, which is the difference
         * between routine housekeeping and a privilege escalation — and the role change in particular
         * left no trace anywhere, because moving a user between roles touches no permission row and so
         * never appeared in any grant diff either.
         */
        var previousFields = new Dictionary<string, string?>
        {
            ["salutation"] = user.Salutation,
            ["name"] = user.Name,
            ["email"] = user.Email,
            ["phoneNumber"] = user.PhoneNumber,
            ["role"] = user.Role?.Name ?? (user.RoleId?.ToString() ?? "(none)"),
            ["customFields"] = user.ExtraAttributes,
        };

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
        await fineCapabilities.InvalidateAsync(user.Id, ct);

        // Bundled from the same submission as the core-field edit — see UpdateUserWithOverridesRequest's
        // doc comment. Applied AFTER the core fields commit, same ordering the ungated path always used
        // when this was two separate calls.
        if (overrides is not null)
        {
            await ApplyOverridesAsync(id, overrides, actingUserId, ct);
        }

        var actorName = await ResolveActorNameAsync(actingUserId, ct);

        var newRoleNameForAudit = request.RoleId is null
            ? "(none)"
            : await db.Roles.AsNoTracking().Where(r => r.Id == request.RoleId).Select(r => r.Name).FirstOrDefaultAsync(ct)
              ?? request.RoleId.ToString();

        var currentFields = new Dictionary<string, string?>
        {
            ["salutation"] = user.Salutation,
            ["name"] = user.Name,
            ["email"] = user.Email,
            ["phoneNumber"] = user.PhoneNumber,
            ["role"] = newRoleNameForAudit,
            ["customFields"] = user.ExtraAttributes,
        };

        // Values, not just field names. "email changed" leaves a reviewer to go looking for what it
        // used to be; by the time they look, the old value only exists in this row.
        var fieldChanges = previousFields
            .Where(kv => !string.Equals(kv.Value, currentFields[kv.Key], StringComparison.Ordinal))
            .Select(kv => $"{kv.Key}: '{kv.Value ?? "(empty)"}' → '{currentFields[kv.Key] ?? "(empty)"}'")
            .ToList();

        await auditLog.WriteHostAsync(
            actingUserId, actorName, "user.updated",
            AuditLogAppService.Modules.Users, AuditLogAppService.Categories.Crud,
            entityType: "User", entityId: user.Id.ToString(), entityLabel: user.Name,
            details: fieldChanges.Count == 0
                // Reached when the only thing that moved was the status or the overrides, both of
                // which get their own rows. Saying so is more useful than an unqualified "Updated".
                ? $"Saved {user.Email} — no core field changed."
                : $"Updated {user.Email} — {string.Join("; ", fieldChanges)}.",
            sourceIp: SourceIp, userAgent: UserAgent, ct: ct);

        if (statusChanged)
        {
            await auditLog.WriteHostAsync(
                actingUserId, actorName,
                request.IsActive ? "user.activated" : "user.deactivated",
                AuditLogAppService.Modules.Users, AuditLogAppService.Categories.Crud,
                entityType: "User", entityId: user.Id.ToString(), entityLabel: user.Name,
                details: $"{user.Email} was {(request.IsActive ? "activated" : "deactivated")}.",
                sourceIp: SourceIp, userAgent: UserAgent, ct: ct);
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
        await auditLog.WriteHostAsync(
            actingUserId, actorName, isActive ? "user.activated" : "user.deactivated",
            AuditLogAppService.Modules.Users, AuditLogAppService.Categories.Crud,
            entityType: "User", entityId: user.Id.ToString(),
            details: $"{(isActive ? "Activated" : "Deactivated")} {user.Email}",
            entityLabel: user.Name, sourceIp: SourceIp, userAgent: UserAgent, ct: ct);

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
        await auditLog.WriteHostAsync(
            actingUserId, actorName, "user.deleted",
            AuditLogAppService.Modules.Users, AuditLogAppService.Categories.Crud,
            entityType: "User", entityId: user.Id.ToString(), details: $"Deleted {user.Email}",
            entityLabel: user.Name, sourceIp: SourceIp, userAgent: UserAgent, ct: ct);
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

        // Feature keys for everything this call touches, so the audit row names permissions the way
        // the Role editor and the JWT do rather than by an opaque FeatureId. One lookup for the union
        // of the existing and requested sets — the requested half is already in `features` above, but
        // the EXISTING half may reference features this request never mentioned.
        var touchedFeatureIds = existing.Select(r => r.FeatureId)
            .Concat(resolved.Select(r => r.FeatureId))
            .Distinct()
            .ToList();
        var featureKeyById = await db.PermissionFeatures.AsNoTracking()
            .Where(f => touchedFeatureIds.Contains(f.Id))
            .ToDictionaryAsync(f => f.Id, f => f.Key, ct);
        string KeyOf(Guid featureId) => featureKeyById.GetValueOrDefault(featureId, featureId.ToString());

        var addedOverrides = new List<PermissionChangeDto>();
        var removedOverrides = new List<PermissionChangeDto>();

        foreach (var row in existing)
        {
            if (requested.TryGetValue((row.FeatureId, row.Capability), out var effect))
            {
                // Kept. Update the effect in place if it flipped between Grant and Revoke, rather than
                // deleting and re-adding the same unique key.
                if (row.Effect != effect)
                {
                    // A flip is recorded as both halves. "Revoke became Grant" is a privilege
                    // ESCALATION on that capability, and collapsing it to a single "changed" line
                    // would hide the direction, which is the only part that matters.
                    removedOverrides.Add(new PermissionChangeDto(KeyOf(row.FeatureId), row.Capability, row.Effect.ToString()));
                    addedOverrides.Add(new PermissionChangeDto(KeyOf(row.FeatureId), row.Capability, effect.ToString()));
                    row.Effect = effect;
                }
            }
            else
            {
                db.UserPermissionOverrides.Remove(row);
                removedOverrides.Add(new PermissionChangeDto(KeyOf(row.FeatureId), row.Capability, row.Effect.ToString()));
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
            addedOverrides.Add(new PermissionChangeDto(KeyOf(featureId), capability, effect.ToString()));
        }

        await db.SaveChangesAsync(ct);

        // This user's overrides changed and nobody else's did, so the targeted eviction is enough.
        await fineCapabilities.InvalidateAsync(userId, ct);

        /*
         * This wrote no audit row at all until now, on either the direct or the replay path.
         *
         * A per-user override is the sharpest privilege instrument in the system: it grants or revokes
         * one capability for one person, outside their role, and it is exactly how an exception gets
         * made permanently and quietly. The trail recorded the role edits around it and stayed silent
         * about this — so "who gave this account Delete on Users, and when?" was unanswerable whenever
         * the answer was an override rather than a role.
         *
         * Written after SaveChanges so it only records changes that actually committed, and skipped
         * entirely when the diff is empty: a Save that re-sent an unchanged set is not an event.
         */
        var diff = new PermissionDiffDto(addedOverrides, removedOverrides);
        if (!diff.IsEmpty)
        {
            var subject = await db.Users.AsNoTracking()
                .Where(u => u.Id == userId)
                .Select(u => new { u.Name, u.Email })
                .FirstOrDefaultAsync(ct);
            var actorName = actingUserId is null
                ? null
                : await db.Users.AsNoTracking().Where(u => u.Id == actingUserId).Select(u => u.Name).FirstOrDefaultAsync(ct);

            await auditLog.WriteHostAsync(
                actingUserId, actorName, "user.permission_overrides_replaced",
                AuditLogAppService.Modules.Users, AuditLogAppService.Categories.Crud,
                entityType: "UserPermissionOverrides", entityId: userId.ToString(),
                entityLabel: subject?.Email ?? subject?.Name,
                details: diff.ToDetails(
                    $"Changed per-user permission overrides for {subject?.Name ?? "a user"} — {diff.Summarise()}."),
                sourceIp: SourceIp, userAgent: UserAgent, ct: ct);
        }

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
    /// <param name="currentValue">The user's saved salutation, on an edit. Keeping it is always allowed, even
    /// if it has since been removed from the list — otherwise removing a title made every user who held
    /// it impossible to save until someone changed their title too.</param>
    private async Task<string?> ValidateSalutationAsync(string? salutation, CancellationToken ct, string? currentValue = null)
    {
        var trimmed = salutation?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        if (string.Equals(trimmed, currentValue, StringComparison.Ordinal))
        {
            return trimmed;
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

    /// <summary>
    /// Flags the rows on this page that have never had an invite redeemed, in one extra query rather
    /// than a correlated subquery per row — the projection above runs through a static helper EF
    /// translates, and a per-row EXISTS cannot be expressed there.
    ///
    /// A Google account is never awaiting a password (it has none), and a disabled one is not either:
    /// resending would be refused, and offering it on the row would be a lie.
    /// </summary>
    private async Task<List<UserListItemDto>> MarkAwaitingSetupAsync(
        List<UserListItemDto> items, CancellationToken ct)
    {
        var candidateIds = items
            .Where(i => i.AuthProvider == nameof(AuthProvider.Local) && i.IsActive)
            .Select(i => i.Id)
            .ToList();

        if (candidateIds.Count == 0) return items;

        var alreadySetUp = await db.SetPasswordInvites
            .Where(i => candidateIds.Contains(i.UserId) && i.UsedAt != null)
            .Select(i => i.UserId)
            .Distinct()
            .ToListAsync(ct);

        return items
            .Select(i => i with
            {
                AwaitingPasswordSetup = candidateIds.Contains(i.Id) && !alreadySetUp.Contains(i.Id),
            })
            .ToList();
    }

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
