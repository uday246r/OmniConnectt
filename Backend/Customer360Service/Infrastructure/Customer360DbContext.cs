using Microsoft.EntityFrameworkCore;
using backend.Models;

namespace backend.Infrastructure
{
    /// <summary>
    /// Customer360Service's own database — new as of this feature. Everything this service used to
    /// persist (audit trail) lived only in a local file with no schema; this is the first real,
    /// admin-editable, durable table set it owns, following the same EF Core + Npgsql pattern
    /// AuthService already uses (see AuthDbContext).
    /// </summary>
    public class Customer360DbContext(DbContextOptions<Customer360DbContext> options) : DbContext(options)
    {
        public DbSet<FieldConfig> FieldConfigs => Set<FieldConfig>();
        public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<FieldConfig>(entity =>
            {
                entity.ToTable("field_configs");
                entity.HasKey(f => f.Id);
                // One row per (profile type, field) — an admin edits a field's config in place rather
                // than accumulating duplicate rows for the same field.
                entity.HasIndex(f => new { f.ProfileType, f.ApiField }).IsUnique();
                entity.Property(f => f.ProfileType).HasConversion<string>().HasMaxLength(20);
                entity.Property(f => f.ApiField).HasMaxLength(150);
                entity.Property(f => f.DisplayLabel).HasMaxLength(200);
                entity.Property(f => f.Section).HasMaxLength(150);
                entity.Property(f => f.MaskingRule).HasConversion<string>().HasMaxLength(40);
            });

            modelBuilder.Entity<AuditLog>(entity =>
            {
                // Moves the audit trail off the local audit_logs.json file (AuditRepository) and onto
                // this same database — a redeploy no longer silently wipes it, and multiple instances
                // no longer each keep their own diverging file.
                entity.ToTable("audit_logs");
                entity.HasKey(a => a.Id);
                entity.Property(a => a.Id).HasMaxLength(64);
                entity.Property(a => a.User).HasMaxLength(200);
                entity.Property(a => a.Action).HasMaxLength(100);
                entity.Property(a => a.Status).HasMaxLength(20);
                entity.Property(a => a.CustomerName).HasMaxLength(300);
                entity.Property(a => a.CustomerType).HasMaxLength(50);
                entity.Property(a => a.CustomerId).HasMaxLength(150);
                entity.Property(a => a.Field).HasMaxLength(200);
                // Reads are always newest-first, paged, and often filtered by Action — same access
                // pattern AuthService's own audit-adjacent indexes are built around.
                entity.HasIndex(a => a.Timestamp);
                entity.HasIndex(a => a.Action);
            });
        }
    }
}
