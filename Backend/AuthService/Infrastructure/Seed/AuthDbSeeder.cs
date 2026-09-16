using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;

namespace AuthService.Infrastructure.Seed;

/// <summary>
/// Bootstraps a brand-new AuthDb with the host's own permission catalog (the features the host
/// application itself owns, each with its own small fixed capability set — everything else in the
/// catalog arrives later, written by RemoteAppAppService as remote apps get registered,
/// each declaring its own dynamic capability set) and a starter set of built-in roles + one Super
/// Admin account so there is a way to log in on day one.
///
/// Idempotent: safe to run on every startup, only inserts what's missing.
/// </summary>
public static class AuthDbSeeder
{
    // Host-owned permission features. Keys are stable identifiers referenced by RolePermission /
    // UserPermissionOverride rows and by the frontend's route/section permission gates.
    public static class HostFeatureKeys
    {
        public const string Dashboard = "host.dashboard";
        public const string SettingsUsers = "host.settings.users";
        public const string SettingsRoles = "host.settings.roles";
        public const string SettingsApplications = "host.settings.applications";
        public const string SystemAuditLogs = "host.system.audit-logs";
        public const string SystemLogs = "host.system.system-logs";
        public const string SystemApprovals = "host.system.approvals";
        public const string SystemCheckerAssignment = "host.system.checker-assignment";
    }

    private static readonly string[] StandardCrud = ["View", "Create", "Edit", "Delete"];
    private static readonly string[] ViewOnly = ["View"];

    // Enterprise action vocabulary — Layer 1 (fixed host permissions). Confirmed with the user:
    // Users gains Disable (status toggle, distinct from Edit's field changes); Applications' create
    // action is renamed Create→Register (registering a remote app IS the create operation, named
    // more specifically) and gains Disable (status toggle); Roles is unchanged; Audit Logs gains
    // Export. See RenameLegacyCapabilityAsync for how the Create→Register migration preserves
    // existing role grants instead of silently dropping them.
    private static readonly string[] UsersCapabilities = ["View", "Create", "Edit", "Delete", "Disable"];
    private static readonly string[] ApplicationsCapabilities = ["View", "Register", "Edit", "Delete", "Disable"];
    private static readonly string[] AuditLogsCapabilities = ["View", "Export"];
    private static readonly string[] SystemLogsCapabilities = ["View", "Export"];

    // Maker-Checker Approval Workflow — Approvals covers viewing the centralized Approval Center and
    // acting on requests (Approve covers both approve and reject, matching how Disable already covers
    // both enable and disable above); Checker Assignment is deliberately its own, separate, narrower
    // feature — "only users with Manage Checker Assignment permission" per the requirement, kept apart
    // from Approvals' own View/Approve so a checker doesn't automatically get to reconfigure who the
    // checkers are.
    // Export is separate from View for the same reason it is on the two log features: reading the
    // approval queue on screen and taking a copy of it off the platform are different decisions, and
    // an organisation may well grant the first widely and the second narrowly.
    private static readonly string[] ApprovalsCapabilities = ["View", "Approve", "Export"];
    private static readonly string[] CheckerAssignmentCapabilities = ["View", "Manage"];

    /// <summary>Pre-rename feature key. Its absence is the marker that legacy data migrations are already done.</summary>
    private const string LegacyMaintenanceFeatureKey = "host.settings.maintenance";

    public static async Task SeedAsync(AuthDbContext db, ILogger logger, CancellationToken ct = default)
    {
        // These two are one-time data migrations from earlier schema revisions. They are pure
        // overhead on every subsequent boot, and this seeder runs BEFORE the port opens — so their
        // cost is paid by startup latency on a possibly-cold serverless database every single time.
        //
        // A single cheap existence check gates both. The legacy feature key is the marker: if no row
        // still uses it, neither migration has anything left to do. This turns ~3 round trips into 1
        // on every warm boot, which is the common case.
        var hasLegacyRows = await db.PermissionFeatures.AnyAsync(f => f.Key == LegacyMaintenanceFeatureKey, ct);
        if (hasLegacyRows)
        {
            // "Maintenance" was renamed to "Applications" as the platform matured — rename the
            // existing row in place (RolePermission references FeatureId, not the key string, so
            // every existing grant survives untouched) rather than seeding a duplicate and orphaning
            // the old one.
            await RenameLegacyFeatureKeyAsync(db, LegacyMaintenanceFeatureKey, HostFeatureKeys.SettingsApplications, "Setup — Applications", ct);

            // Applications' "Create" capability became "Register" — rename the capability row AND
            // re-point every existing RolePermission/UserPermissionOverride grant that referenced
            // "Create" by its key string, so no admin silently loses register-app access on upgrade.
            await RenameLegacyCapabilityAsync(db, HostFeatureKeys.SettingsApplications, "Create", "Register", ct);
        }

        var features = await SeedHostFeaturesAsync(db, ct);
        var roles = await SeedRolesAsync(db, features, ct);
        await SeedSuperAdminUserAsync(db, roles, logger, ct);
        await SeedNavigationAsync(db, logger, ct);
        await LegacyFeatureCleanup.RunAsync(db, logger, ct);

        // Diagnostic only — logs grants the claims builder will no longer mint. Runs last, so it sees
        // the catalog exactly as the rest of startup left it.
        await StaleGrantReport.RunAsync(db, logger, ct);
    }

    /// <summary>
    /// Seeds the sidebar's sections and the host's own rows.
    /// <para>
    /// These used to be a static C# list, which meant renaming a heading or reordering the sidebar
    /// required redeploying this service. They are data now: the navigation endpoint reads them, and
    /// the browser renders whatever it is given.
    /// </para>
    /// <para>
    /// Insert-only, keyed on what already exists, so an operator who has since renamed a label or
    /// moved a row keeps their change across restarts. There is deliberately no "Setup" section: those
    /// five screens live behind the Topbar gear, and duplicating them in the sidebar meant one
    /// destination reachable two ways.
    /// </para>
    /// </summary>
    private static async Task SeedNavigationAsync(AuthDbContext db, ILogger logger, CancellationToken ct)
    {
        var seedSections = new[]
        {
            new NavSection { Key = "main", Label = "Main", SortOrder = 10, PinToBottom = false },
            new NavSection { Key = "apps", Label = "Apps", SortOrder = 20, PinToBottom = false },
            // Pinned so it sits below the apps list rather than floating at the bottom of the viewport.
            new NavSection { Key = "system", Label = "System", SortOrder = 30, PinToBottom = true },
        };

        var existingSections = await db.NavSections.Select(s => s.Key).ToListAsync(ct);
        var newSections = seedSections.Where(s => !existingSections.Contains(s.Key)).ToList();
        if (newSections.Count > 0)
        {
            db.NavSections.AddRange(newSections);
            await db.SaveChangesAsync(ct);
        }

        var seedItems = new[]
        {
            new HostNavItem { Id = Guid.NewGuid(), Key = "host.dashboard", Label = "Dashboard", IconKey = "Home", RoutePath = "/", SectionKey = "main", SortOrder = 10, RequiredFeatureKey = HostFeatureKeys.Dashboard, RequiredCapability = "View" },
            new HostNavItem { Id = Guid.NewGuid(), Key = "host.system.approvals", Label = "Approval Center", IconKey = "UserCheck", RoutePath = "/system/approvals", SectionKey = "system", SortOrder = 10, RequiredFeatureKey = HostFeatureKeys.SystemApprovals, RequiredCapability = "View" },
            // Ungated on purpose: it shows only the caller's own requests, scoped server-side, so
            // gating it would hide the page from exactly the people it exists for.
            new HostNavItem { Id = Guid.NewGuid(), Key = "host.my-requests", Label = "My Requests", IconKey = "Clock", RoutePath = "/my-requests", SectionKey = "system", SortOrder = 20, RequiredFeatureKey = null, RequiredCapability = null },
            new HostNavItem { Id = Guid.NewGuid(), Key = "host.system.audit-logs", Label = "Audit Logs", IconKey = "FileText", RoutePath = "/system/audit-logs", SectionKey = "system", SortOrder = 30, RequiredFeatureKey = HostFeatureKeys.SystemAuditLogs, RequiredCapability = "View" },
            new HostNavItem { Id = Guid.NewGuid(), Key = "host.system.system-logs", Label = "System Logs", IconKey = "Terminal", RoutePath = "/system/system-logs", SectionKey = "system", SortOrder = 40, RequiredFeatureKey = HostFeatureKeys.SystemLogs, RequiredCapability = "View" },
            // Moved out of the Settings drawer's tab strip into real, linkable pages alongside Audit
            // Logs — both reuse the Users feature key, same reasoning as UserSchemaController/
            // ValidationPresetsController/SalutationsController: managing the user-creation form is
            // part of the Users capability, not a separate permission to seed and expose in Roles.
            new HostNavItem { Id = Guid.NewGuid(), Key = "host.settings.fields", Label = "Manage Fields", IconKey = "FileText", RoutePath = "/settings/fields", SectionKey = "system", SortOrder = 50, RequiredFeatureKey = HostFeatureKeys.SettingsUsers, RequiredCapability = "View" },
            new HostNavItem { Id = Guid.NewGuid(), Key = "host.settings.formats", Label = "Manage Formats", IconKey = "Key", RoutePath = "/settings/formats", SectionKey = "system", SortOrder = 60, RequiredFeatureKey = HostFeatureKeys.SettingsUsers, RequiredCapability = "View" },
        };

        var existingItems = await db.HostNavItems.Select(h => h.Key).ToListAsync(ct);
        var newItems = seedItems.Where(h => !existingItems.Contains(h.Key)).ToList();
        if (newItems.Count > 0)
        {
            db.HostNavItems.AddRange(newItems);
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Seeded {Sections} navigation section(s) and {Items} host nav row(s).", newSections.Count, newItems.Count);
        }
    }



    private static async Task RenameLegacyFeatureKeyAsync(AuthDbContext db, string oldKey, string newKey, string newDisplayName, CancellationToken ct)
    {
        var existing = await db.PermissionFeatures.FirstOrDefaultAsync(f => f.Key == oldKey, ct);
        if (existing is null)
        {
            return;
        }

        existing.Key = newKey;
        existing.DisplayName = newDisplayName;
        existing.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
    }

    private static async Task RenameLegacyCapabilityAsync(AuthDbContext db, string featureKey, string oldCapability, string newCapability, CancellationToken ct)
    {
        var feature = await db.PermissionFeatures.FirstOrDefaultAsync(f => f.Key == featureKey, ct);
        if (feature is null)
        {
            return;
        }

        var oldRow = await db.PermissionFeatureCapabilities
            .FirstOrDefaultAsync(c => c.FeatureId == feature.Id && c.Key == oldCapability, ct);
        if (oldRow is null)
        {
            // Already renamed (or never existed) — nothing to do. This is the common case on
            // every startup after the first.
            return;
        }

        // Defensive: if a row already holds the new key (should only happen if a previous run's
        // rename partially applied — e.g. the capability row was updated but the process died
        // before the grants below were re-pointed), renaming oldRow.Key would collide with it on
        // the (FeatureId, Key) unique index. Re-point any grants still on the old key onto the
        // already-correct new row and remove the stale duplicate instead of blindly updating.
        var newRowAlreadyExists = await db.PermissionFeatureCapabilities
            .AnyAsync(c => c.FeatureId == feature.Id && c.Key == newCapability, ct);

        if (newRowAlreadyExists)
        {
            db.PermissionFeatureCapabilities.Remove(oldRow);
        }
        else
        {
            oldRow.Key = newCapability;
            oldRow.DisplayName = newCapability;
        }

        var rolePermissions = await db.RolePermissions
            .Where(rp => rp.FeatureId == feature.Id && rp.Capability == oldCapability)
            .ToListAsync(ct);
        foreach (var rp in rolePermissions)
        {
            rp.Capability = newCapability;
        }

        var overrides = await db.UserPermissionOverrides
            .Where(o => o.FeatureId == feature.Id && o.Capability == oldCapability)
            .ToListAsync(ct);
        foreach (var o in overrides)
        {
            o.Capability = newCapability;
        }

        await db.SaveChangesAsync(ct);
    }

    private static async Task<Dictionary<string, PermissionFeature>> SeedHostFeaturesAsync(AuthDbContext db, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var seedFeatures = new[]
        {
            new { Key = HostFeatureKeys.Dashboard, DisplayName = "Dashboard", SortOrder = 0, Capabilities = ViewOnly },
            new { Key = HostFeatureKeys.SettingsUsers, DisplayName = "Setup — User", SortOrder = 10, Capabilities = UsersCapabilities },
            new { Key = HostFeatureKeys.SettingsRoles, DisplayName = "Setup — Role", SortOrder = 20, Capabilities = StandardCrud },
            new { Key = HostFeatureKeys.SettingsApplications, DisplayName = "Setup — Applications", SortOrder = 30, Capabilities = ApplicationsCapabilities },
            new { Key = HostFeatureKeys.SystemAuditLogs, DisplayName = "System — Audit Logs", SortOrder = 40, Capabilities = AuditLogsCapabilities },
            new { Key = HostFeatureKeys.SystemLogs, DisplayName = "System — System Logs", SortOrder = 45, Capabilities = SystemLogsCapabilities },
            new { Key = HostFeatureKeys.SystemApprovals, DisplayName = "System — Approval Center", SortOrder = 50, Capabilities = ApprovalsCapabilities },
            new { Key = HostFeatureKeys.SystemCheckerAssignment, DisplayName = "System — Checker Assignment", SortOrder = 60, Capabilities = CheckerAssignmentCapabilities },
        };

        var existing = await db.PermissionFeatures.Include(f => f.Capabilities).ToDictionaryAsync(f => f.Key, ct);

        foreach (var seed in seedFeatures)
        {
            if (existing.TryGetValue(seed.Key, out var feature))
            {
                // Feature row already exists (from an earlier startup) — make sure its capability
                // set is caught up too, in case a new host capability was added since.
                var existingCapKeys = feature.Capabilities.Select(c => c.Key).ToHashSet();
                foreach (var capKey in seed.Capabilities.Where(c => !existingCapKeys.Contains(c)))
                {
                    db.PermissionFeatureCapabilities.Add(new PermissionFeatureCapability
                    {
                        Id = Guid.NewGuid(),
                        FeatureId = feature.Id,
                        Key = capKey,
                        DisplayName = capKey,
                        SortOrder = Array.IndexOf(seed.Capabilities, capKey),
                    });
                }
                continue;
            }

            feature = new PermissionFeature
            {
                Id = Guid.NewGuid(),
                Key = seed.Key,
                DisplayName = seed.DisplayName,
                Source = PermissionFeatureSource.Host,
                IsActive = true,
                SortOrder = seed.SortOrder,
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.PermissionFeatures.Add(feature);

            // Keep the in-memory map authoritative: it is what this method returns, replacing a
            // second full read of the table. Omitting this would drop every newly-created feature
            // from the result on a first run.
            existing[seed.Key] = feature;

            for (var i = 0; i < seed.Capabilities.Length; i++)
            {
                db.PermissionFeatureCapabilities.Add(new PermissionFeatureCapability
                {
                    Id = Guid.NewGuid(),
                    FeatureId = feature.Id,
                    Key = seed.Capabilities[i],
                    DisplayName = seed.Capabilities[i],
                    SortOrder = i,
                });
            }
        }

        if (db.ChangeTracker.HasChanges())
        {
            await db.SaveChangesAsync(ct);
        }

        // `existing` already holds every feature — the pre-existing ones loaded above, plus any this
        // method just created (added to the dictionary as they were constructed). Re-querying the
        // whole PermissionFeatures table here was a second full read of data already in memory, on
        // every single startup.
        return existing;
    }

    private static async Task<Dictionary<string, Role>> SeedRolesAsync(
        AuthDbContext db,
        Dictionary<string, PermissionFeature> features,
        CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;

        // (name, description, isAdministrator, grants) — grants maps a feature key to the
        // capabilities that feature exposes for this role. All are built-in/system roles so they
        // can't be deleted, but admins can still edit their permissions freely.
        var seedRoles = new (string Name, string Description, bool IsAdministrator, Dictionary<string, string[]> Grants)[]
        {
            ("Super Admin", "Unrestricted access to every feature and function.", true, []),
            ("Admin", "Full access except deleting users or roles.", false, new()
            {
                [HostFeatureKeys.Dashboard] = ["View"],
                [HostFeatureKeys.SettingsUsers] = ["View", "Create", "Edit", "Disable"],
                [HostFeatureKeys.SettingsRoles] = ["View", "Create", "Edit"],
                [HostFeatureKeys.SettingsApplications] = ["View", "Register", "Edit", "Disable"],
                [HostFeatureKeys.SystemAuditLogs] = ["View", "Export"],
                [HostFeatureKeys.SystemLogs] = ["View", "Export"],
                // Export matches what Admin already holds on the two log features — this role exists
                // to run the platform day to day, and producing evidence of a period's approvals is
                // part of that.
                [HostFeatureKeys.SystemApprovals] = ["View", "Approve", "Export"],
                // Manage stays Super-Admin-only, per "only users with Manage Checker Assignment
                // permission" — Admin can see who's assigned but not reassign checkers.
                [HostFeatureKeys.SystemCheckerAssignment] = ["View"],
            }),
            ("Manager", "Runs campaigns, contacts and boards day to day.", false, new()
            {
                [HostFeatureKeys.Dashboard] = ["View"],
            }),
            ("Agent", "Handles conversations and contacts assigned to them.", false, new()
            {
                [HostFeatureKeys.Dashboard] = ["View"],
            }),
            ("Normal User", "Basic access to chat, contacts and their own work.", false, new()
            {
                [HostFeatureKeys.Dashboard] = ["View"],
            }),
            ("Read Only User", "Can view everything but change nothing.", false, new()
            {
                [HostFeatureKeys.Dashboard] = ["View"],
                [HostFeatureKeys.SettingsUsers] = ["View"],
                [HostFeatureKeys.SettingsRoles] = ["View"],
                [HostFeatureKeys.SettingsApplications] = ["View"],
                [HostFeatureKeys.SystemAuditLogs] = ["View"],
                [HostFeatureKeys.SystemLogs] = ["View"],
                [HostFeatureKeys.SystemApprovals] = ["View"],
                [HostFeatureKeys.SystemCheckerAssignment] = ["View"],
            }),
        };

        // Load full entities once, keyed by name. This previously read the Roles table TWICE on
        // every startup — once for names to test existence, then again at the end to build the
        // dictionary this returns. One read serves both.
        var roles = await db.Roles.ToDictionaryAsync(r => r.Name, ct);

        foreach (var seed in seedRoles)
        {
            if (roles.ContainsKey(seed.Name))
            {
                continue;
            }

            var role = new Role
            {
                Id = Guid.NewGuid(),
                Name = seed.Name,
                Description = seed.Description,
                IsSystemRole = true,
                IsAdministrator = seed.IsAdministrator,
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.Roles.Add(role);
            roles[seed.Name] = role;

            foreach (var (featureKey, capabilities) in seed.Grants)
            {
                if (!features.TryGetValue(featureKey, out var feature))
                {
                    continue;
                }

                foreach (var capability in capabilities)
                {
                    db.RolePermissions.Add(new RolePermission
                    {
                        Id = Guid.NewGuid(),
                        RoleId = role.Id,
                        FeatureId = feature.Id,
                        Capability = capability,
                    });
                }
            }
        }

        if (db.ChangeTracker.HasChanges())
        {
            await db.SaveChangesAsync(ct);
        }

        return roles;
    }

    private static async Task SeedSuperAdminUserAsync(
        AuthDbContext db,
        Dictionary<string, Role> roles,
        ILogger logger,
        CancellationToken ct)
    {
        const string bootstrapEmail = "superadmin@omniconnect.com";
        // Generated, never a literal. A password committed to source is the same password on every
        // install of this platform, so anyone who has read the repository holds the founding
        // credential of every deployment that was not hardened after first boot.
        var bootstrapPassword = TemporaryPasswordGenerator.Generate();

        if (await db.Users.AnyAsync(ct))
        {
            return;
        }

        if (!roles.TryGetValue("Super Admin", out var superAdminRole))
        {
            logger.LogError("Cannot seed bootstrap user: Super Admin role was not seeded.");
            return;
        }

        var now = DateTimeOffset.UtcNow;
        var hasher = new PasswordHasher();

        var user = new User
        {
            Id = Guid.NewGuid(),
            Name = "Super Admin",
            Email = bootstrapEmail,
            PasswordHash = string.Empty,
            Status = UserStatus.Active,
            RoleId = superAdminRole.Id,
            // MustChangePasswordFilter is registered globally, so this account can reach nothing but
            // the change-password endpoint until the generated password is replaced.
            MustChangePassword = true,
            CreatedAt = now,
            UpdatedAt = now,
        };
        user.PasswordHash = hasher.Hash(user, bootstrapPassword);

        db.Users.Add(user);
        await db.SaveChangesAsync(ct);

        // Printed ONCE, at first-run seeding only, and unrecoverable afterwards — only the hash is
        // stored. Logs do travel further than the database, which is the cost of this approach; a
        // per-install random secret that reaches one log is still strictly better than a constant
        // that reaches everyone holding the repository.
        logger.LogWarning(
            "Seeded the bootstrap Super Admin account.\n  Email:    {Email}\n  Password: {Password}\n"
                + "This is printed once and cannot be recovered. Sign in, change it immediately, and "
                + "clear it from your terminal scrollback.",
            bootstrapEmail, bootstrapPassword);
    }
}
