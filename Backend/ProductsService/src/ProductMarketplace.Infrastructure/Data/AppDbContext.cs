using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Domain.Entities;
using DomainApplication = ProductMarketplace.Domain.Entities.Application;

namespace ProductMarketplace.Infrastructure.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<Category> Categories => Set<Category>();
    public DbSet<ProductType> ProductTypes => Set<ProductType>();
    public DbSet<FieldDefinition> FieldDefinitions => Set<FieldDefinition>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<ProductFieldValue> ProductFieldValues => Set<ProductFieldValue>();
    public DbSet<ProductBenefit> ProductBenefits => Set<ProductBenefit>();
    public DbSet<ProductEligibility> ProductEligibilities => Set<ProductEligibility>();
    public DbSet<Review> Reviews => Set<Review>();
    public DbSet<Promotion> Promotions => Set<Promotion>();
    public DbSet<DomainApplication> Applications => Set<DomainApplication>();
    public DbSet<ApplicationFieldValue> ApplicationFieldValues => Set<ApplicationFieldValue>();
    public DbSet<ApplicationDocument> ApplicationDocuments => Set<ApplicationDocument>();
    public DbSet<ApplicationStatusHistory> ApplicationStatusHistories => Set<ApplicationStatusHistory>();
    public DbSet<SearchLog> SearchLogs => Set<SearchLog>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<ProductViewLog> ProductViewLogs => Set<ProductViewLog>();
    public DbSet<DocumentDefinition> DocumentDefinitions => Set<DocumentDefinition>();
    public DbSet<StatusConfig> StatusConfigs => Set<StatusConfig>();
    public DbSet<EmploymentType> EmploymentTypes => Set<EmploymentType>();
    public DbSet<RankingConfig> RankingConfigs => Set<RankingConfig>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
    }
}
