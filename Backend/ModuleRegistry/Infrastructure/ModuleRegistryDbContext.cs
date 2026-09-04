using Microsoft.EntityFrameworkCore;
using ModuleRegistry.Domain.Entities;

namespace ModuleRegistry.Infrastructure;

public class ModuleRegistryDbContext(DbContextOptions<ModuleRegistryDbContext> options) : DbContext(options)
{
    public DbSet<RemoteApp> RemoteApps => Set<RemoteApp>();
    public DbSet<RemoteAppCapability> RemoteAppCapabilities => Set<RemoteAppCapability>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<RemoteApp>(entity =>
        {
            entity.HasIndex(a => a.Key).IsUnique();
            entity.HasIndex(a => a.PermissionFeatureKey).IsUnique();
            entity.Property(a => a.Key).HasMaxLength(100);
            entity.Property(a => a.DisplayName).HasMaxLength(200);
            entity.Property(a => a.IconKey).HasMaxLength(100);
            entity.Property(a => a.ManifestUrl).HasMaxLength(2048);
            entity.Property(a => a.MaintenanceMessage).HasMaxLength(2000);
            entity.Property(a => a.PermissionFeatureKey).HasMaxLength(200);
            entity.Property(a => a.PermissionsSourceUrl).HasMaxLength(2048);
            entity.Property(a => a.Status).HasConversion<string>().HasMaxLength(20);
            entity.Property(a => a.Health).HasConversion<string>().HasMaxLength(20);
            entity.Property(a => a.LastHealthError).HasMaxLength(1000);
            entity.Property(a => a.ContainerName).HasMaxLength(200);

            // Both list queries order by SidebarOrder and the sidebar query also filters on Status.
            entity.HasIndex(a => new { a.Status, a.SidebarOrder });
        });

        modelBuilder.Entity<RemoteAppCapability>(entity =>
        {
            // Uniqueness is now per (app, module, capability) — "View" can legitimately exist under
            // both the Employee and Department sub-modules of the same app.
            entity.HasIndex(c => new { c.RemoteAppId, c.ModuleKey, c.Key }).IsUnique();
            entity.Property(c => c.ModuleKey).HasMaxLength(100);
            entity.Property(c => c.ModuleDisplayName).HasMaxLength(150);
            // Sized to match AuthDb's PermissionFeatureCapability. Truncating here would corrupt a
            // dotted key on its way through, and a key that arrives shortened than it left is a grant
            // that silently stops matching.
            entity.Property(c => c.Key).HasMaxLength(150);
            entity.Property(c => c.DisplayName).HasMaxLength(200);
            entity.Property(c => c.Description).HasMaxLength(500);
            entity.Property(c => c.Type).HasMaxLength(20);

            entity.HasOne(c => c.RemoteApp)
                .WithMany(a => a.Capabilities)
                .HasForeignKey(c => c.RemoteAppId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
