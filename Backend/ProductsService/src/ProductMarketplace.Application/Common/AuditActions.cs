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

    public const string CreateReview = "review.create";
    public const string ReviewStatusChange = "review.status_change";
    public const string DeleteReview = "review.delete";

    public const string CreatePromotion = "promotion.create";
    public const string UpdatePromotion = "promotion.update";
    public const string PromotionStatusChange = "promotion.status_change";
    public const string DeletePromotion = "promotion.delete";

    public const string CreateApplication = "application.create";
    public const string ApplicationStatusChange = "application.status_change";
    public const string UploadApplicationDocument = "application.document_upload";
    public const string RemoveApplicationDocument = "application.document_remove";

    public const string CreateProductType = "product_type.create";
    public const string UpdateProductType = "product_type.update";
    public const string DeleteProductType = "product_type.delete";

    public const string CreateField = "field.create";
    public const string UpdateField = "field.update";
    public const string DeleteField = "field.delete";

    public const string CreateDocumentDefinition = "document_definition.create";
    public const string UpdateDocumentDefinition = "document_definition.update";
    public const string DeleteDocumentDefinition = "document_definition.delete";

    public const string CreateStatusConfig = "status_config.create";
    public const string UpdateStatusConfig = "status_config.update";
    public const string DeleteStatusConfig = "status_config.delete";

    public const string CreateEmploymentType = "employment_type.create";
    public const string UpdateEmploymentType = "employment_type.update";
    public const string DeleteEmploymentType = "employment_type.delete";

    public const string UpdateRankingConfig = "ranking_config.update";
}

public static class AuditEntityTypes
{
    public const string Product = "Product";
    public const string Category = "Category";
    public const string Review = "Review";
    public const string Promotion = "Promotion";
    public const string Application = "Application";
    public const string Search = "Search";
    public const string ProductType = "ProductType";
    public const string FieldDefinition = "FieldDefinition";
    public const string DocumentDefinition = "DocumentDefinition";
    public const string StatusConfig = "StatusConfig";
    public const string EmploymentType = "EmploymentType";
    public const string RankingConfig = "RankingConfig";
}

/// <summary>Entity types that own a configurable status enum, and are therefore valid EntityType
/// values for a StatusConfig row. Kept as one list so seeding and validation can't drift apart.</summary>
public static class StatusEntityTypes
{
    public const string Product = "Product";
    public const string Category = "Category";
    public const string Review = "Review";
    public const string Promotion = "Promotion";
    public const string Application = "Application";
}
