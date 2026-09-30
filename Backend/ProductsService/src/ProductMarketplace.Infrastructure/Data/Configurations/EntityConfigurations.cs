using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ProductMarketplace.Domain.Entities;

namespace ProductMarketplace.Infrastructure.Data.Configurations;

public class CategoryConfiguration : IEntityTypeConfiguration<Category>
{
    public void Configure(EntityTypeBuilder<Category> builder)
    {
        builder.Property(c => c.Name).HasMaxLength(150).IsRequired();
        builder.Property(c => c.Code).HasMaxLength(30).IsRequired();
        builder.Property(c => c.Status).HasMaxLength(50).IsRequired();
        builder.Property(c => c.IconKey).HasMaxLength(50);
        builder.HasIndex(c => c.Code).IsUnique();
        builder.HasIndex(c => c.Name).IsUnique();
        // The category list and the catalogue's tabs read in display order.
        builder.HasIndex(c => new { c.Status, c.DisplayOrder });
    }
}

public class SubCategoryConfiguration : IEntityTypeConfiguration<SubCategory>
{
    public void Configure(EntityTypeBuilder<SubCategory> builder)
    {
        builder.Property(s => s.Name).HasMaxLength(150).IsRequired();
        builder.Property(s => s.Code).HasMaxLength(30).IsRequired();
        builder.Property(s => s.Status).HasMaxLength(50).IsRequired();
        builder.Property(s => s.IconKey).HasMaxLength(50);
        // Restrict: a category that still has sub-categories cannot be deleted out from under them.
        builder.HasOne(s => s.Category).WithMany(c => c.SubCategories).HasForeignKey(s => s.CategoryId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(s => s.Code).IsUnique();
        // A category cannot hold two sub-categories of the same name; two categories may (a "Personal" in each).
        builder.HasIndex(s => new { s.CategoryId, s.Name }).IsUnique();
        builder.HasIndex(s => new { s.CategoryId, s.DisplayOrder });
    }
}

public class FieldDefinitionConfiguration : IEntityTypeConfiguration<FieldDefinition>
{
    public void Configure(EntityTypeBuilder<FieldDefinition> builder)
    {
        builder.Property(f => f.Key).HasMaxLength(100).IsRequired();
        builder.Property(f => f.Label).HasMaxLength(150).IsRequired();
        // The service's one JSON column. jsonb, so it is validated as JSON by the database and can be
        // queried into later without a migration.
        builder.Property(f => f.ValidationsJson).HasColumnType("jsonb");
        builder.HasOne(f => f.SubCategory).WithMany(s => s.FieldDefinitions).HasForeignKey(f => f.SubCategoryId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(f => new { f.SubCategoryId, f.Key }).IsUnique();
    }
}

public class ProductConfiguration : IEntityTypeConfiguration<Product>
{
    public void Configure(EntityTypeBuilder<Product> builder)
    {
        builder.Property(p => p.Name).HasMaxLength(200).IsRequired();
        builder.Property(p => p.Code).HasMaxLength(50).IsRequired();
        builder.Property(p => p.Status).HasMaxLength(50).IsRequired();
        builder.Property(p => p.IconKey).HasMaxLength(50);
        builder.HasIndex(p => p.Code).IsUnique();
        builder.HasOne(p => p.SubCategory).WithMany(s => s.Products).HasForeignKey(p => p.SubCategoryId).OnDelete(DeleteBehavior.Restrict);

        // The catalogue lists one sub-category's products by status, newest first: this composite serves
        // the filter and the sort together, so a page is read from the index rather than sorted after.
        builder.HasIndex(p => new { p.SubCategoryId, p.Status, p.CreatedAt, p.Id });
        // The status tabs and the dashboard's status breakdown group by status alone.
        builder.HasIndex(p => p.Status);
        builder.HasIndex(p => p.CreatedAt);
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
        // Sorting or filtering by a numeric attribute ("lowest rate") reads one field's numbers.
        builder.HasIndex(v => new { v.FieldDefinitionId, v.NumericValue });
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

public class DocumentDefinitionConfiguration : IEntityTypeConfiguration<DocumentDefinition>
{
    public void Configure(EntityTypeBuilder<DocumentDefinition> builder)
    {
        builder.Property(d => d.Name).HasMaxLength(150).IsRequired();
        builder.Property(d => d.DocumentType).HasMaxLength(100);
        builder.HasOne(d => d.SubCategory).WithMany(s => s.DocumentDefinitions).HasForeignKey(d => d.SubCategoryId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(d => d.SubCategoryId);
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
