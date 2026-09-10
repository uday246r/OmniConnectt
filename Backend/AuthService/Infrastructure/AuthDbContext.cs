using AuthService.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Npgsql.EntityFrameworkCore.PostgreSQL;

namespace AuthService.Infrastructure;

public class AuthDbContext(DbContextOptions<AuthDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Role> Roles => Set<Role>();
    public DbSet<PermissionFeature> PermissionFeatures => Set<PermissionFeature>();
    public DbSet<PermissionFeatureCapability> PermissionFeatureCapabilities => Set<PermissionFeatureCapability>();
    public DbSet<RolePermission> RolePermissions => Set<RolePermission>();
    public DbSet<UserPermissionOverride> UserPermissionOverrides => Set<UserPermissionOverride>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<SystemLog> SystemLogs => Set<SystemLog>();
    public DbSet<ApprovalRequest> ApprovalRequests => Set<ApprovalRequest>();
    public DbSet<CheckerAssignment> CheckerAssignments => Set<CheckerAssignment>();
    public DbSet<SetPasswordInvite> SetPasswordInvites => Set<SetPasswordInvite>();
    public DbSet<FeatureNavItem> FeatureNavItems => Set<FeatureNavItem>();
    public DbSet<RemoteAppNavMetadata> RemoteAppNavMetadata => Set<RemoteAppNavMetadata>();
    public DbSet<NavSection> NavSections => Set<NavSection>();
    public DbSet<HostNavItem> HostNavItems => Set<HostNavItem>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Role>(entity =>
        {
            entity.HasIndex(r => r.Name).IsUnique();
            entity.Property(r => r.Name).HasMaxLength(100);
            entity.Property(r => r.Description).HasMaxLength(500);
        });

        modelBuilder.Entity<User>(entity =>
        {
            // PARTIAL unique index — uniqueness applies only to rows that are actually live.
            //
            // Deletion here is soft (see the HasQueryFilter below), so an unfiltered unique index made
            // a deleted user's address unusable forever: the duplicate check respects the query filter
            // and sees nothing, while the index still holds the address, and the INSERT fails with a
            // raw DbUpdateException. The filter string must stay in sync with the migration
            // 20260818090000_PartialUniqueEmailForSoftDelete, or EF will scaffold a migration to
            // undo it.
            entity.HasIndex(u => u.Email).IsUnique().HasFilter("\"IsDeleted\" = false");
            entity.Property(u => u.Name).HasMaxLength(200);
            entity.Property(u => u.Email).HasMaxLength(320);
            entity.Property(u => u.PhoneNumber).HasMaxLength(32);
            entity.Property(u => u.Status).HasConversion<string>().HasMaxLength(20);
            entity.Property(u => u.AuthProvider).HasConversion<string>().HasMaxLength(20);

            entity.HasOne(u => u.Role)
                .WithMany(r => r.Users)
                .HasForeignKey(u => u.RoleId)
                .OnDelete(DeleteBehavior.Restrict); // role deletion is blocked at the app layer while users reference it; this is defense in depth

            entity.HasQueryFilter(u => !u.IsDeleted);

            // Every page of GET /api/users sorts by Name, and GET /api/roles/{id}/users does too —
            // previously an unindexed sort of the whole filtered set on every request.
            entity.HasIndex(u => u.Name);

            // Status is an equality filter on the same list endpoint.
            entity.HasIndex(u => u.Status);

            // IsDeleted is appended to EVERY Users query by the global filter above, so it is the
            // single most-touched predicate in this service.
            entity.HasIndex(u => u.IsDeleted);
        });

        modelBuilder.Entity<PermissionFeature>(entity =>
        {
            entity.HasIndex(f => f.Key).IsUnique();
            entity.Property(f => f.Key).HasMaxLength(200);
            entity.Property(f => f.DisplayName).HasMaxLength(200);

            // Self-referencing hierarchy: a sub-module is a feature whose parent is its module.
            // Restrict, not Cascade — a module must not silently take its sub-modules' grant history
            // with it; deactivation (IsActive = false) is the intended removal path.
            entity.HasOne(f => f.ParentFeature)
                .WithMany(f => f.Children)
                .HasForeignKey(f => f.ParentFeatureId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(f => f.ParentFeatureId);
            entity.Property(f => f.Source).HasConversion<string>().HasMaxLength(20);
        });

        modelBuilder.Entity<FeatureNavItem>(entity =>
        {
            entity.HasIndex(n => new { n.FeatureId, n.NavKey }).IsUnique();

            // Cascade, unlike RolePermission's Restrict. These rows are replicated presentation data
            // with no grant history in them — nothing is lost by removing them with their feature,
            // and leaving orphans would mean a sidebar row pointing at a feature that is gone.
            entity.HasOne(n => n.Feature)
                .WithMany()
                .HasForeignKey(n => n.FeatureId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.Property(n => n.NavKey).HasMaxLength(100);
            entity.Property(n => n.Label).HasMaxLength(200);
            entity.Property(n => n.IconKey).HasMaxLength(100);
            entity.Property(n => n.RouteSegment).HasMaxLength(100);
            entity.Property(n => n.RequiredCapability).HasMaxLength(50);
        });

        modelBuilder.Entity<RemoteAppNavMetadata>(entity =>
        {
            // Keyed by FeatureId rather than an Id of its own: exactly one metadata row per feature,
            // enforced by the primary key instead of an index that could be forgotten.
            entity.HasKey(m => m.FeatureId);

            entity.HasOne(m => m.Feature)
                .WithMany()
                .HasForeignKey(m => m.FeatureId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.Property(m => m.IconKey).HasMaxLength(100);
            entity.Property(m => m.ManifestUrl).HasMaxLength(2048);
            entity.Property(m => m.ContainerName).HasMaxLength(200);
            entity.Property(m => m.Status).HasMaxLength(20);
            entity.Property(m => m.MaintenanceMessage).HasMaxLength(2000);
        });

        modelBuilder.Entity<NavSection>(entity =>
        {
            // The key IS the identity — sections are referenced by name from HostNavItem and from the
            // tree builder, so a surrogate id would only add a lookup.
            entity.HasKey(s => s.Key);
            entity.Property(s => s.Key).HasMaxLength(50);
            entity.Property(s => s.Label).HasMaxLength(100);
        });

        modelBuilder.Entity<HostNavItem>(entity =>
        {
            entity.HasIndex(h => h.Key).IsUnique();

            entity.HasOne(h => h.Section)
                .WithMany()
                .HasForeignKey(h => h.SectionKey)
                // Restrict: removing a section that still has rows should fail loudly rather than
                // silently deleting navigation.
                .OnDelete(DeleteBehavior.Restrict);

            entity.Property(h => h.Key).HasMaxLength(100);
            entity.Property(h => h.Label).HasMaxLength(200);
            entity.Property(h => h.IconKey).HasMaxLength(100);
            entity.Property(h => h.RoutePath).HasMaxLength(400);
            entity.Property(h => h.SectionKey).HasMaxLength(50);

            // Deliberately a plain string, not a foreign key to PermissionFeature: it is nullable for
            // ungated rows, and features are keyed by a string the seeder owns anyway.
            entity.Property(h => h.RequiredFeatureKey).HasMaxLength(200);
            entity.Property(h => h.RequiredCapability).HasMaxLength(50);
        });

        modelBuilder.Entity<PermissionFeatureCapability>(entity =>
        {
            entity.HasIndex(c => new { c.FeatureId, c.Key }).IsUnique();

            // Widened from 50: dotted keys such as "chart.leads-over-time" are longer than the bare
            // verbs ("Create", "View") this column was sized for.
            entity.Property(c => c.Key).HasMaxLength(150);
            entity.Property(c => c.DisplayName).HasMaxLength(200);
            entity.Property(c => c.Description).HasMaxLength(500);
            entity.Property(c => c.GroupKey).HasMaxLength(100);

            // Stored as a string, like every other enum here, so inserting a new type in the middle
            // of the enum can never silently re-map existing rows.
            entity.Property(c => c.Type).HasConversion<string>().HasMaxLength(20);

            entity.HasOne(c => c.Feature)
                .WithMany(f => f.Capabilities)
                .HasForeignKey(c => c.FeatureId)
                .OnDelete(DeleteBehavior.Cascade); // a feature's own capability rows are pure metadata about it, safe to cascade
        });

        modelBuilder.Entity<RolePermission>(entity =>
        {
            entity.HasIndex(rp => new { rp.RoleId, rp.FeatureId, rp.Capability }).IsUnique();
            entity.Property(rp => rp.Capability).HasMaxLength(50);

            entity.HasOne(rp => rp.Role)
                .WithMany(r => r.RolePermissions)
                .HasForeignKey(rp => rp.RoleId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(rp => rp.Feature)
                .WithMany(f => f.RolePermissions)
                .HasForeignKey(rp => rp.FeatureId)
                .OnDelete(DeleteBehavior.Restrict); // features are soft-deactivated, never hard-deleted, so this should never fire
        });

        modelBuilder.Entity<UserPermissionOverride>(entity =>
        {
            entity.HasIndex(o => new { o.UserId, o.FeatureId, o.Capability }).IsUnique();
            entity.Property(o => o.Capability).HasMaxLength(50);
            entity.Property(o => o.Effect).HasConversion<string>().HasMaxLength(20);

            entity.HasOne(o => o.User)
                .WithMany(u => u.PermissionOverrides)
                .HasForeignKey(o => o.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(o => o.Feature)
                .WithMany(f => f.UserPermissionOverrides)
                .HasForeignKey(o => o.FeatureId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        // Mirrors the RefreshToken configuration below, for the same reasons: lookup is always by
        // hash so that index must be unique, and the expiry index serves both the redemption check
        // and any future cleanup sweep.
        modelBuilder.Entity<SetPasswordInvite>(entity =>
        {
            entity.HasIndex(i => i.TokenHash).IsUnique();
            entity.Property(i => i.TokenHash).HasMaxLength(200);
            entity.HasIndex(i => i.ExpiresAt);

            // Finding a user's outstanding invite happens on every re-issue.
            entity.HasIndex(i => new { i.UserId, i.UsedAt, i.RevokedAt });

            entity.HasOne(i => i.User)
                .WithMany()
                .HasForeignKey(i => i.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<RefreshToken>(entity =>
        {
            entity.HasIndex(t => t.TokenHash).IsUnique();
            entity.Property(t => t.TokenHash).HasMaxLength(200);
            entity.Property(t => t.CreatedByIp).HasMaxLength(64);

            // Serves the cleanup sweep, which filters on ExpiresAt and would otherwise scan a table
            // that grows by ~96 rows per active user per day.
            entity.HasIndex(t => t.ExpiresAt);

            entity.HasOne(t => t.User)
                .WithMany(u => u.RefreshTokens)
                .HasForeignKey(t => t.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<AuditLog>(entity =>
        {
            entity.HasIndex(a => a.OccurredAt);
            entity.HasIndex(a => a.ServiceName);

            // AuditLogs is the fastest-growing table in the system — every login attempt, success or
            // failure, writes a row. These three columns are all filtered or aggregated on and had
            // no index at all.
            //
            // Action backs the two equality counts in SummaryAsync ("auth.login_succeeded" /
            // "auth.login_failed"), which run on every dashboard and audit-page load.
            entity.HasIndex(a => a.Action);

            // ActorUserId backs SummaryAsync's Distinct().Count() for the active-users card.
            entity.HasIndex(a => a.ActorUserId);

            // Composite, and ordered deliberately: the audit page filters by ServiceName/Result and
            // then sorts by OccurredAt descending. Two separate single-column indexes cannot serve
            // "filter then sort" in one pass — Postgres would still need a separate sort step. These
            // let the whole query be satisfied by one index scan.
            entity.HasIndex(a => new { a.ServiceName, a.OccurredAt })
                .IsDescending(false, true);
            entity.HasIndex(a => new { a.Result, a.OccurredAt })
                .IsDescending(false, true);
            entity.Property(a => a.ServiceName).HasMaxLength(100);
            entity.Property(a => a.Action).HasMaxLength(150);
            entity.Property(a => a.ActorName).HasMaxLength(200);
            entity.Property(a => a.EntityType).HasMaxLength(100);
            entity.Property(a => a.EntityId).HasMaxLength(200);
            entity.Property(a => a.EntityLabel).HasMaxLength(300);
            entity.Property(a => a.SourceIp).HasMaxLength(64);

            entity.HasIndex(a => a.SourceApplication);
            entity.HasIndex(a => a.ActionCategory);
            entity.HasIndex(a => new { a.ActorUserId, a.OccurredAt }).IsDescending(false, true);
            entity.Property(a => a.SourceApplication).HasMaxLength(100);
            entity.Property(a => a.HostOrRemote).HasMaxLength(10);
            entity.Property(a => a.RemoteName).HasMaxLength(100);
            entity.Property(a => a.Module).HasMaxLength(200);
            entity.Property(a => a.Page).HasMaxLength(200);
            entity.Property(a => a.ActionCategory).HasMaxLength(50);
        });

        modelBuilder.Entity<SystemLog>(entity =>
        {
            entity.HasIndex(a => a.OccurredAt);
            entity.HasIndex(a => a.Severity);
            entity.HasIndex(a => a.ServiceName);
            entity.HasIndex(a => a.EventCode);
            entity.HasIndex(a => new { a.Severity, a.OccurredAt }).IsDescending(false, true);
            entity.HasIndex(a => new { a.ServiceName, a.OccurredAt }).IsDescending(false, true);
            
            entity.Property(a => a.ServiceName).HasMaxLength(100);
            entity.Property(a => a.Severity).HasMaxLength(20);
            entity.Property(a => a.Module).HasMaxLength(100);
            entity.Property(a => a.Environment).HasMaxLength(50);
            entity.Property(a => a.EventCode).HasMaxLength(150);
            entity.Property(a => a.Message).HasMaxLength(2000);
            entity.Property(a => a.CorrelationId).HasMaxLength(200);
            entity.Property(a => a.RequestId).HasMaxLength(200);
        });

        modelBuilder.Entity<ApprovalRequest>(entity =>
        {
            entity.Property(a => a.Module).HasMaxLength(100);
            entity.Property(a => a.Action).HasMaxLength(30);
            entity.Property(a => a.EntityType).HasMaxLength(100);
            entity.Property(a => a.EntityId).HasMaxLength(200);
            entity.Property(a => a.EntityLabel).HasMaxLength(300);
            entity.Property(a => a.EntityKey).HasMaxLength(200);
            entity.Property(a => a.Status).HasMaxLength(20);
            entity.Property(a => a.MakerName).HasMaxLength(200);
            entity.Property(a => a.CheckerName).HasMaxLength(200);
            entity.Property(a => a.RejectionReason).HasMaxLength(1000);
            entity.Property(a => a.SourceService).HasMaxLength(100);
            entity.Property(a => a.CallbackUrl).HasMaxLength(500);
            // 512 comfortably covers base64(12 + 16 + 14 bytes); sized generously so a longer
            // generated password in future does not need a second migration.
            entity.Property(a => a.TempPasswordCiphertext).HasMaxLength(512);

            // Approval Center's default view: pending, newest first.
            entity.HasIndex(a => new { a.Status, a.RequestedAt }).IsDescending(false, true);
            // A checker's own queue, and the real-time "assigned to me, pending" badge count.
            entity.HasIndex(a => new { a.CheckerId, a.Status });
            // My Requests, newest first.
            entity.HasIndex(a => new { a.MakerId, a.RequestedAt }).IsDescending(false, true);
            // Approval Center's module/application filter.
            entity.HasIndex(a => new { a.Module, a.Status });

            /*
             * ONE open approval request per record — enforced by the database, not just by the
             * application check in ApprovalGatingService.SubmitAsync.
             *
             * PARTIAL unique index: uniqueness applies only while Status = 'Pending', so the same
             * record can be requested again once the previous request has been approved or rejected —
             * which is the whole point. Without the WHERE clause a user could never be deleted twice
             * in their lifetime.
             *
             * The application check exists to produce a helpful "already pending with X since Y"
             * error; this index is what makes the rule actually hold when two makers submit
             * simultaneously and both pass that check before either commits. A NULL EntityKey never
             * collides (Postgres treats NULLs as distinct), so a module that hasn't adopted a key is
             * simply un-deduplicated rather than broken.
             *
             * The filter string must stay in sync with the migration
             * 20260821..._AddEntityKeyAndPendingUniqueIndex, or EF will scaffold a migration to undo it.
             */
            entity.HasIndex(a => new { a.Module, a.EntityKey }).IsUnique().HasFilter("\"Status\" = 'Pending'");


            // Restrict, not Cascade — an approval request is itself a historical/audit record and must
            // never silently disappear because the maker or checker account was later deleted (soft
            // delete already keeps the User row in place regardless, so this should never actually fire).
            entity.HasOne<User>().WithMany().HasForeignKey(a => a.MakerId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<User>().WithMany().HasForeignKey(a => a.CheckerId).OnDelete(DeleteBehavior.Restrict);

            /*
             * Optimistic concurrency on the decision.
             *
             * Two checkers (or one checker double-clicking, or an administrator and the assigned
             * checker) can hit Approve at the same instant. Both reads pass EnsureDecidable's
             * "Status == Pending" check before either writes, so without this the mutation replays
             * TWICE — and for a soft delete the second replay succeeds silently, leaving no trace
             * except two audit rows.
             *
             * xmin is Postgres's own per-row transaction id: a system column, so this costs no schema
             * change and no bookkeeping. EF appends it to the UPDATE's WHERE clause, the loser matches
             * zero rows, and ApprovalAppService turns the resulting DbUpdateConcurrencyException into a
             * plain "already decided" 409.
             */
            entity.Property<uint>("xmin").HasColumnName("xmin").ValueGeneratedOnAddOrUpdate().IsConcurrencyToken();
        });

        modelBuilder.Entity<CheckerAssignment>(entity =>
        {
            entity.Property(c => c.Module).HasMaxLength(100);

            /*
             * An assignment targets a user OR a role, never both and never neither.
             *
             * The uniqueness indexes are PARTIAL for that reason: a plain unique index on
             * (Module, CheckerUserId) would treat every role assignment as a row with a NULL user.
             * One filtered index per target type states the real rule: a given user appears at most once per module, and so does a given role.
             */

            entity.HasIndex(c => new { c.Module, c.CheckerUserId }).IsUnique().HasFilter("\"CheckerUserId\" IS NOT NULL");
entity.HasIndex(c => new { c.Module, c.CheckerRoleId }).IsUnique().HasFilter("\"CheckerRoleId\" IS NOT NULL");
entity.ToTable(t => t.HasCheckConstraint(
    "CK_CheckerAssignment_UserOrRole",
    "(\"CheckerUserId\" IS NOT NULL AND \"CheckerRoleId\" IS NULL) OR "
    + "(\"CheckerUserId\" IS NULL AND \"CheckerRoleId\" IS NOT NULL)"));
          
            // Backs both IsGatedAsync's existence check and the least-workload selection query.
            entity.HasIndex(c => c.Module);

            entity.HasOne(c => c.CheckerUser)
                .WithMany()
                .HasForeignKey(c => c.CheckerUserId)
                .OnDelete(DeleteBehavior.Restrict);

            // Restrict, like the user relationship: deleting a role that is somebody's approval route
            // must fail loudly rather than silently leaving a module with no reachable checker.
            entity.HasOne(c => c.CheckerRole)
                .WithMany()
                .HasForeignKey(c => c.CheckerRoleId)
                .OnDelete(DeleteBehavior.Restrict);
        });
    }
}
