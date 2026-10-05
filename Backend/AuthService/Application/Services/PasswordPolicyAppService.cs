using System.Text.Json;
using AuthService.Application.DTOs;
using AuthService.Application.Exceptions;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using AuthService.Options;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace AuthService.Application.Services;

/// <summary>
/// The platform password policy: how long a password lives (globally and per role), what a new one must
/// look like, and when users are warned before theirs expires. One database row, edited on Settings &gt;
/// Manage Password Policy.
/// <para>
/// Deliberately small. It answers three questions and nothing else — "has this user's password
/// expired?", "is this new password acceptable?" and "should this user be warned yet?" — because every
/// extra setting is one more thing an auditor has to ask whether it is actually enforced. An earlier
/// version carried templates, per-field inheritance, lockout, history and MFA flags; none of it was ever
/// read by an enforcement path, which is worse than not having it.
/// </para>
/// </summary>
public class PasswordPolicyAppService(
    AuthDbContext db,
    AuditLogAppService auditLog,
    IOptions<PasswordPolicyOptions> seedOptions)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>Upper bound for any expiry, in days (10 years) — a typo guard, not a business rule.</summary>
    public const int MaxExpiryDays = 3650;

    public const int MaxLeadDayEntries = 5;

    private const string StaleMessage =
        "Someone else changed the password policy while you were editing. Reload to see their changes, then make yours again.";

    // ------------------------------------------------------------------ reads

    /// <summary>The policy page's view: the policy plus the roles it can be attached to.</summary>
    public async Task<PasswordPolicyCatalogDto> GetAsync(CancellationToken ct = default)
    {
        var (policy, version, updatedAt) = await ReadAsync(ct);
        return new PasswordPolicyCatalogDto(policy, version, updatedAt, await LoadRolesAsync(ct));
    }

    /// <summary>
    /// The policy only, for the login/refresh/password-set paths and the reminder job. Deliberately does
    /// not load roles: this runs on every sign-in and every silent refresh.
    /// </summary>
    public async Task<PasswordPolicyDefinitionDto> GetPolicyAsync(CancellationToken ct = default)
        => (await ReadAsync(ct)).Policy;

    private async Task<(PasswordPolicyDefinitionDto Policy, int Version, DateTimeOffset UpdatedAt)> ReadAsync(CancellationToken ct)
    {
        var row = await db.PasswordPolicyCatalogs.AsNoTracking().OrderByDescending(c => c.UpdatedAt).FirstOrDefaultAsync(ct);
        var roleExpiries = await db.PasswordPolicyRoleExpiries.AsNoTracking()
            .OrderBy(r => r.RoleId)
            .Select(r => new RolePasswordExpiryDto(r.RoleId, r.ExpiryDays))
            .ToListAsync(ct);

        if (row is null)
        {
            return (DefaultPolicy() with { RoleExpiries = roleExpiries }, 0, DateTimeOffset.UtcNow);
        }

        return (Parse(row.PolicyJson) with { RoleExpiries = roleExpiries }, row.Version, row.UpdatedAt);
    }

    private async Task<IReadOnlyList<PasswordPolicyRoleDto>> LoadRolesAsync(CancellationToken ct)
    {
        var roles = await db.Roles.AsNoTracking().OrderBy(r => r.Name).Select(r => new { r.Id, r.Name }).ToListAsync(ct);
        // Counted through db.Users so the soft-delete filter applies — a deleted account is not "affected".
        var counts = await db.Users.AsNoTracking()
            .Where(u => u.RoleId != null)
            .GroupBy(u => u.RoleId!.Value)
            .Select(g => new { RoleId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.RoleId, g => g.Count, ct);
        return roles.Select(r => new PasswordPolicyRoleDto(r.Id, r.Name, counts.GetValueOrDefault(r.Id))).ToList();
    }

    /// <summary>The complexity rules only — what a new password must satisfy.</summary>
    public async Task<PasswordComplexityDto> GetComplexityAsync(CancellationToken ct = default)
        => (await GetPolicyAsync(ct)).Complexity;

    // ------------------------------------------------------------------ evaluation

    /// <summary>
    /// How many days this user's password lives. A role's own entry wins outright (it is not clamped to
    /// the global value); otherwise the global value applies. 0 means never.
    /// </summary>
    public static int ResolveExpiryDays(User user, PasswordPolicyDefinitionDto policy)
    {
        if (user.RoleId is { } roleId)
        {
            var roleEntry = policy.RoleExpiries.FirstOrDefault(r => r.RoleId == roleId);
            if (roleEntry is not null) return roleEntry.ExpiryDays;
        }

        return policy.ExpiryDays;
    }

    /// <summary>
    /// Where <paramref name="user"/> stands against <paramref name="policy"/>.
    /// <para>
    /// Only a local account with a password can expire. A Google-provisioned account has no OmniConnect
    /// password to rotate, and an invite that has not been accepted yet has no password either — treating
    /// either as "expired" would lock out someone who has nothing to change.
    /// </para>
    /// <para>
    /// The clock runs from <c>PasswordChangedAt</c>, falling back to <c>CreatedAt</c> for an account that
    /// has never recorded a change. The rollout migration backfills <c>PasswordChangedAt</c> for existing
    /// accounts so switching the policy on does not expire everyone created more than N days ago at once.
    /// </para>
    /// </summary>
    public static PasswordExpiryStatusDto Evaluate(User user, PasswordPolicyDefinitionDto policy, DateTimeOffset? asOf = null)
    {
        var now = asOf ?? DateTimeOffset.UtcNow;
        var days = ResolveExpiryDays(user, policy);

        var applies = user.AuthProvider == AuthProvider.Local && user.PasswordHash is not null && days > 0;
        if (!applies)
        {
            return new PasswordExpiryStatusDto(days, user.PasswordChangedAt, null, null, false, false);
        }

        var expiresAt = (user.PasswordChangedAt ?? user.CreatedAt).AddDays(days);
        var isExpired = now >= expiresAt;

        // Whole days left, rounded UP: "3 hours left" reads as "1 day", never as "0 days" on a password
        // that is still valid. An expired password reports 0.
        var daysRemaining = isExpired ? 0 : (int)Math.Ceiling((expiresAt - now).TotalDays);

        var widestLead = policy.Notifications.LeadDays is { Count: > 0 } lead ? lead.Max() : 0;
        var inWarningWindow = !isExpired && widestLead > 0 && daysRemaining <= widestLead;

        return new PasswordExpiryStatusDto(days, user.PasswordChangedAt, expiresAt, daysRemaining, isExpired, inWarningWindow);
    }

    // ------------------------------------------------------------------ writes

    public async Task<PasswordPolicyCatalogDto> UpdateAsync(
        UpdatePasswordPolicyRequest request, Guid? actingUserId, CancellationToken ct = default)
    {
        var policy = Sanitize(request.Policy);
        await ValidateAsync(policy, ct);

        var row = await db.PasswordPolicyCatalogs.OrderByDescending(c => c.UpdatedAt).FirstOrDefaultAsync(ct);

        if (request.ExpectedVersion is { } expectedVersion && expectedVersion != (row?.Version ?? 0))
        {
            throw new ConflictAppException(StaleMessage);
        }

        var now = DateTimeOffset.UtcNow;
        // Role overrides are stored as rows (see PasswordPolicyRoleExpiry), not in the JSON, so the JSON
        // carries the global settings only.
        var policyJson = JsonSerializer.Serialize(policy with { RoleExpiries = [] }, JsonOptions);

        if (row is null)
        {
            row = new PasswordPolicyCatalog
            {
                Id = Guid.NewGuid(),
                PolicyJson = policyJson,
                Version = 1,
                UpdatedAt = now,
                UpdatedBy = actingUserId,
            };
            db.PasswordPolicyCatalogs.Add(row);
        }
        else
        {
            row.PolicyJson = policyJson;
            row.Version += 1;
            row.UpdatedAt = now;
            row.UpdatedBy = actingUserId;
        }

        // The role rows are replaced wholesale in the same save as the version bump, so a reader never sees
        // the new global settings with the old role overrides (or the reverse).
        var existingRoleExpiries = await db.PasswordPolicyRoleExpiries.ToListAsync(ct);
        db.PasswordPolicyRoleExpiries.RemoveRange(existingRoleExpiries);
        foreach (var role in policy.RoleExpiries)
        {
            db.PasswordPolicyRoleExpiries.Add(new PasswordPolicyRoleExpiry
            {
                RoleId = role.RoleId,
                ExpiryDays = role.ExpiryDays,
                UpdatedAt = now,
                UpdatedBy = actingUserId,
            });
        }

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            throw new ConflictAppException(StaleMessage);
        }

        var actorName = actingUserId is null
            ? null
            : await db.Users.AsNoTracking().Where(u => u.Id == actingUserId).Select(u => u.Name).FirstOrDefaultAsync(ct);

        // Loosening this policy changes how long every account's credential stays valid, and what a new
        // one has to look like — configuration with the reach of a code change, so the row names the
        // values rather than just "updated".
        await auditLog.WriteHostAsync(
            actingUserId, actorName, "password_policy.updated",
            AuditLogAppService.Modules.UserSchema, AuditLogAppService.Categories.Configuration,
            entityType: "PasswordPolicyCatalog", entityId: row.Id.ToString(), entityLabel: "Password policy",
            details: $"Saved the password policy (version {row.Version}) — " +
                     $"expiry {(policy.ExpiryDays == 0 ? "never" : $"{policy.ExpiryDays} days")}, " +
                     $"{policy.RoleExpiries.Count} role override(s), " +
                     $"min length {policy.Complexity.MinimumLength}, " +
                     $"warnings {DescribeNotifications(policy.Notifications)}.",
            ct: ct);

        return new PasswordPolicyCatalogDto(policy, row.Version, row.UpdatedAt, await LoadRolesAsync(ct));
    }

    // ------------------------------------------------------------------ shape

    /// <summary>The policy in force before an administrator has saved anything: 90 days, no role
    /// overrides, complexity from the <c>PasswordPolicy</c> appsettings section, warnings 14/7/3/1 days out.</summary>
    public PasswordPolicyDefinitionDto DefaultPolicy()
    {
        var o = seedOptions.Value;
        return new PasswordPolicyDefinitionDto(
            ExpiryDays: 90,
            RoleExpiries: [],
            Complexity: new PasswordComplexityDto(
                o.MinimumLength, o.MaximumLength, o.RequireUppercase, o.RequireLowercase,
                o.RequireDigit, o.RequireNonAlphanumeric, o.RejectSameAsCurrent),
            Notifications: new PasswordExpiryNotificationDto(Email: true, InApp: true, LeadDays: [14, 7, 3, 1]));
    }

    private PasswordPolicyDefinitionDto Parse(string json)
    {
        try
        {
            var parsed = JsonSerializer.Deserialize<PasswordPolicyDefinitionDto>(json, JsonOptions);
            return parsed is null ? DefaultPolicy() : Sanitize(parsed);
        }
        catch (JsonException)
        {
            // Same fail-soft doctrine as the other catalogs: a corrupt row must not make sign-in
            // impossible. The default is always a valid, enforceable policy.
            return DefaultPolicy();
        }
    }

    /// <summary>
    /// Fills anything missing (a property absent from stored JSON deserializes to null) and puts the
    /// lists in canonical form, so the rest of the service never null-checks and a stored row always
    /// round-trips to the same value.
    /// </summary>
    private PasswordPolicyDefinitionDto Sanitize(PasswordPolicyDefinitionDto? policy)
    {
        var fallback = DefaultPolicy();
        if (policy is null) return fallback;

        var roleExpiries = (policy.RoleExpiries ?? [])
            .Where(r => r is not null)
            .GroupBy(r => r.RoleId)
            .Select(g => g.First())
            .OrderBy(r => r.RoleId)
            .ToList();

        var notifications = policy.Notifications ?? fallback.Notifications;
        var leadDays = (notifications.LeadDays ?? fallback.Notifications.LeadDays ?? [])
            .Distinct()
            .OrderByDescending(d => d)
            .ToList();

        return new PasswordPolicyDefinitionDto(
            policy.ExpiryDays,
            roleExpiries,
            policy.Complexity ?? fallback.Complexity,
            notifications with { LeadDays = leadDays });
    }

    private async Task ValidateAsync(PasswordPolicyDefinitionDto policy, CancellationToken ct)
    {
        if (policy.ExpiryDays < 0 || policy.ExpiryDays > MaxExpiryDays)
        {
            throw new ValidationAppException($"Password expiry must be between 0 (never) and {MaxExpiryDays} days.");
        }

        foreach (var role in policy.RoleExpiries)
        {
            if (role.RoleId == Guid.Empty)
            {
                throw new ValidationAppException("A role expiry is missing its role.");
            }

            // 0 is not offered per role: "inherit" is the absence of a row, and a stray 0 typed into one
            // row would silently switch expiry off for every user holding that role.
            if (role.ExpiryDays < 1 || role.ExpiryDays > MaxExpiryDays)
            {
                throw new ValidationAppException($"A role's password expiry must be between 1 and {MaxExpiryDays} days.");
            }
        }

        if (policy.RoleExpiries.Count > 0)
        {
            var ids = policy.RoleExpiries.Select(r => r.RoleId).ToList();
            var known = await db.Roles.AsNoTracking().Where(r => ids.Contains(r.Id)).Select(r => r.Id).ToListAsync(ct);
            if (known.Count != ids.Count)
            {
                throw new ValidationAppException("A role in this policy no longer exists. Reload and try again.");
            }
        }

        var c = policy.Complexity;
        if (c.MinimumLength < 6 || c.MinimumLength > 64)
        {
            throw new ValidationAppException("Minimum password length must be between 6 and 64 characters.");
        }

        if (c.MaximumLength < c.MinimumLength || c.MaximumLength > 256)
        {
            throw new ValidationAppException("Maximum password length must be at least the minimum, and at most 256.");
        }

        var lead = policy.Notifications.LeadDays ?? [];
        if (lead.Count > MaxLeadDayEntries)
        {
            throw new ValidationAppException($"Choose at most {MaxLeadDayEntries} reminder days.");
        }

        if (lead.Any(d => d < 1 || d > MaxExpiryDays))
        {
            throw new ValidationAppException("Reminder days must be whole numbers of 1 or more.");
        }

        // A reminder due on or after the day the password already expires would never be sent.
        if (policy.ExpiryDays > 0 && lead.Any(d => d >= policy.ExpiryDays))
        {
            throw new ValidationAppException("Every reminder must be sooner than the expiry period.");
        }
    }

    private static string DescribeNotifications(PasswordExpiryNotificationDto n)
    {
        var channels = new List<string>();
        if (n.Email) channels.Add("email");
        if (n.InApp) channels.Add("in-app");
        var when = n.LeadDays is { Count: > 0 } ? string.Join("/", n.LeadDays) + " days before" : "none scheduled";
        return channels.Count == 0 ? "off" : $"{string.Join(" + ", channels)} ({when})";
    }
}
