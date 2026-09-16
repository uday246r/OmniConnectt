using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ProductMarketplace.Domain.Entities;
using DomainApplication = ProductMarketplace.Domain.Entities.Application;

namespace ProductMarketplace.Infrastructure.Data.Configurations;

public class CategoryConfiguration : IEntityTypeConfiguration<Category>
{
    public void Configure(EntityTypeBuilder<Category> builder)
    {
        builder.HasIndex(c => c.Slug).IsUnique();
        builder.Property(c => c.Name).HasMaxLength(150).IsRequired();
        builder.Property(c => c.Slug).HasMaxLength(160).IsRequired();
        builder.HasOne(c => c.ParentCategory)
            .WithMany(c => c.SubCategories)
            .HasForeignKey(c => c.ParentCategoryId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

public class ProductTypeConfiguration : IEntityTypeConfiguration<ProductType>
{
    public void Configure(EntityTypeBuilder<ProductType> builder)
    {
        builder.HasIndex(p => p.Code).IsUnique();
        builder.Property(p => p.Name).HasMaxLength(100).IsRequired();
        builder.Property(p => p.Code).HasMaxLength(50).IsRequired();
    }
}

public class FieldDefinitionConfiguration : IEntityTypeConfiguration<FieldDefinition>
{
    public void Configure(EntityTypeBuilder<FieldDefinition> builder)
    {
        builder.Property(f => f.Key).HasMaxLength(100).IsRequired();
        builder.Property(f => f.Label).HasMaxLength(150).IsRequired();
        builder.HasOne(f => f.ProductType)
            .WithMany(pt => pt.FieldDefinitions)
            .HasForeignKey(f => f.ProductTypeId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(f => new { f.ProductTypeId, f.Key }).IsUnique();
    }
}

public class ProductConfiguration : IEntityTypeConfiguration<Product>
{
    public void Configure(EntityTypeBuilder<Product> builder)
    {
        builder.HasIndex(p => p.Code).IsUnique();
        builder.Property(p => p.Name).HasMaxLength(200).IsRequired();
        builder.Property(p => p.Code).HasMaxLength(50).IsRequired();
        builder.HasOne(p => p.Category).WithMany(c => c.Products).HasForeignKey(p => p.CategoryId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(p => p.ProductType).WithMany(t => t.Products).HasForeignKey(p => p.ProductTypeId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(p => p.Status);
        // The catalogue sorts: newest, most applied, top rated.
        builder.HasIndex(p => p.CreatedAt);
        builder.HasIndex(p => p.ApplicationCount);
        builder.HasIndex(p => p.RatingAverage);
    }
}

public class ProductFieldValueConfiguration : IEntityTypeConfiguration<ProductFieldValue>
{
    public void Configure(EntityTypeBuilder<ProductFieldValue> builder)
    {
        builder.HasOne(v => v.Product).WithMany(p => p.FieldValues).HasForeignKey(v => v.ProductId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne(v => v.FieldDefinition).WithMany(f => f.Values).HasForeignKey(v => v.FieldDefinitionId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(v => new { v.ProductId, v.FieldDefinitionId }).IsUnique();
        builder.Property(v => v.NumericValue).HasPrecision(18, 4);
    }
}

public class ProductBenefitConfiguration : IEntityTypeConfiguration<ProductBenefit>
{
    public void Configure(EntityTypeBuilder<ProductBenefit> builder)
    {
        builder.HasOne(b => b.Product).WithMany(p => p.Benefits).HasForeignKey(b => b.ProductId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class ProductEligibilityConfiguration : IEntityTypeConfiguration<ProductEligibility>
{
    public void Configure(EntityTypeBuilder<ProductEligibility> builder)
    {
        builder.HasOne(e => e.Product).WithMany(p => p.EligibilityCriteria).HasForeignKey(e => e.ProductId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class ReviewConfiguration : IEntityTypeConfiguration<Review>
{
    public void Configure(EntityTypeBuilder<Review> builder)
    {
        builder.HasOne(r => r.Product).WithMany(p => p.Reviews).HasForeignKey(r => r.ProductId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(r => r.Status);
    }
}

public class PromotionConfiguration : IEntityTypeConfiguration<Promotion>
{
    public void Configure(EntityTypeBuilder<Promotion> builder)
    {
        builder.HasOne(p => p.Product).WithMany(pr => pr.Promotions).HasForeignKey(p => p.ProductId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(p => p.Status);
    }
}

public class ApplicationConfiguration : IEntityTypeConfiguration<DomainApplication>
{
    public void Configure(EntityTypeBuilder<DomainApplication> builder)
    {
        builder.HasIndex(a => a.ApplicationNumber).IsUnique();
        builder.HasOne(a => a.Product).WithMany(p => p.Applications).HasForeignKey(a => a.ProductId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(a => a.Status);
        builder.HasIndex(a => a.CreatedAt);
    }
}

public class ApplicationFieldValueConfiguration : IEntityTypeConfiguration<ApplicationFieldValue>
{
    public void Configure(EntityTypeBuilder<ApplicationFieldValue> builder)
    {
        builder.HasOne(v => v.Application).WithMany(a => a.FieldValues).HasForeignKey(v => v.ApplicationId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne(v => v.FieldDefinition).WithMany(f => f.ApplicationValues).HasForeignKey(v => v.FieldDefinitionId).OnDelete(DeleteBehavior.SetNull);
    }
}

public class ApplicationDocumentConfiguration : IEntityTypeConfiguration<ApplicationDocument>
{
    public void Configure(EntityTypeBuilder<ApplicationDocument> builder)
    {
        builder.HasOne(d => d.Application).WithMany(a => a.Documents).HasForeignKey(d => d.ApplicationId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class ApplicationStatusHistoryConfiguration : IEntityTypeConfiguration<ApplicationStatusHistory>
{
    public void Configure(EntityTypeBuilder<ApplicationStatusHistory> builder)
    {
        builder.HasOne(h => h.Application).WithMany(a => a.StatusHistory).HasForeignKey(h => h.ApplicationId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class SearchLogConfiguration : IEntityTypeConfiguration<SearchLog>
{
    public void Configure(EntityTypeBuilder<SearchLog> builder)
    {
        builder.HasIndex(s => s.Term).IsUnique();
    }
}

public class AuditLogConfiguration : IEntityTypeConfiguration<AuditLog>
{
    public void Configure(EntityTypeBuilder<AuditLog> builder)
    {
        builder.HasIndex(a => a.Timestamp);
        builder.HasIndex(a => a.Action);
        builder.HasIndex(a => a.EntityType);
        builder.HasIndex(a => a.ActorUserId);
        builder.HasIndex(a => new { a.EntityType, a.EntityId });
        builder.Property(a => a.ActorName).HasMaxLength(150);
        builder.Property(a => a.Action).HasMaxLength(100);
        builder.Property(a => a.EntityType).HasMaxLength(50);
    }
}

public class ProductViewLogConfiguration : IEntityTypeConfiguration<ProductViewLog>
{
    public void Configure(EntityTypeBuilder<ProductViewLog> builder)
    {
        builder.HasOne(v => v.Product).WithMany(p => p.ViewLogs).HasForeignKey(v => v.ProductId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(v => v.ViewedAt);
    }
}

public class DocumentDefinitionConfiguration : IEntityTypeConfiguration<DocumentDefinition>
{
    public void Configure(EntityTypeBuilder<DocumentDefinition> builder)
    {
        builder.Property(d => d.Name).HasMaxLength(150).IsRequired();
        builder.Property(d => d.DocumentType).HasMaxLength(100);
        builder.HasOne(d => d.ProductType).WithMany(t => t.DocumentDefinitions).HasForeignKey(d => d.ProductTypeId).OnDelete(DeleteBehavior.Cascade);
    }
}

public class StatusConfigConfiguration : IEntityTypeConfiguration<StatusConfig>
{
    public void Configure(EntityTypeBuilder<StatusConfig> builder)
    {
        builder.Property(s => s.EntityType).HasMaxLength(50).IsRequired();
        builder.Property(s => s.Value).HasMaxLength(50).IsRequired();
        builder.Property(s => s.Label).HasMaxLength(100).IsRequired();
        builder.Property(s => s.Color).HasMaxLength(30).IsRequired();
        builder.HasIndex(s => new { s.EntityType, s.Value }).IsUnique();
    }
}
