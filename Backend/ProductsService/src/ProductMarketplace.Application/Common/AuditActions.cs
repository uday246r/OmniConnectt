namespace ProductMarketplace.Application.Common;

/// <summary>Canonical audit action keys. Stored as plain strings (not an enum/DB constraint) so new
/// action types can be introduced without a schema migration - matches the extensible, config-driven
/// philosophy used for product field definitions.</summary>
public static class AuditActions
{
    public const string Search = "search";
    public const string ViewProduct = "product.view";

    public const string CreateProduct = "product.create";
    public const string UpdateProduct = "product.update";
    public const string DeleteProduct = "product.delete";
    public const string ProductStatusChange = "product.status_change";

    public const string CreateCategory = "category.create";
    public const string UpdateCategory = "category.update";
    public const string DeleteCategory = "category.delete";
    public const string ReorderCategory = "category.reorder";

    public const string CreateSubCategory = "sub_category.create";
    public const string UpdateSubCategory = "sub_category.update";
    public const string DeleteSubCategory = "sub_category.delete";
    public const string ReorderSubCategory = "sub_category.reorder";

    public const string CreateField = "field.create";
    public const string UpdateField = "field.update";
    public const string DeleteField = "field.delete";

    public const string CreateDocumentDefinition = "document_definition.create";
    public const string UpdateDocumentDefinition = "document_definition.update";
    public const string DeleteDocumentDefinition = "document_definition.delete";

    public const string CreateStatusConfig = "status_config.create";
    public const string UpdateStatusConfig = "status_config.update";
    public const string DeleteStatusConfig = "status_config.delete";
}

public static class AuditEntityTypes
{
    public const string Product = "Product";
    public const string Category = "Category";
    public const string SubCategory = "SubCategory";
    public const string Search = "Search";
    public const string FieldDefinition = "FieldDefinition";
    public const string DocumentDefinition = "DocumentDefinition";
    public const string StatusConfig = "StatusConfig";
}

/// <summary>Entity types that own a configurable status, and are therefore valid EntityType values for a
/// StatusConfig row. Kept as one list so seeding and validation can't drift apart.</summary>
public static class StatusEntityTypes
{
    public const string Product = "Product";
    public const string SubCategory = "SubCategory";
    public const string Category = "Category";

    public static readonly IReadOnlyList<string> All = [Product, SubCategory, Category];
}
