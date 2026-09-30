using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Domain.Entities;

namespace ProductMarketplace.Infrastructure.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<Category> Categories => Set<Category>();
    public DbSet<SubCategory> SubCategories => Set<SubCategory>();
    public DbSet<FieldDefinition> FieldDefinitions => Set<FieldDefinition>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<ProductFieldValue> ProductFieldValues => Set<ProductFieldValue>();
    public DbSet<ProductBenefit> ProductBenefits => Set<ProductBenefit>();
    public DbSet<ProductEligibility> ProductEligibilities => Set<ProductEligibility>();
    public DbSet<SearchLog> SearchLogs => Set<SearchLog>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<DocumentDefinition> DocumentDefinitions => Set<DocumentDefinition>();
    public DbSet<StatusConfig> StatusConfigs => Set<StatusConfig>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
    }
}
