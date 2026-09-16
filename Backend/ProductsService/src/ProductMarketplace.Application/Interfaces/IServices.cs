using ProductMarketplace.Application.Common;
using ProductMarketplace.Application.Dtos;

namespace ProductMarketplace.Application.Interfaces;

public interface ICategoryService
{
    Task<List<CategoryDto>> GetAllAsync(string? status, CancellationToken ct = default);
    Task<CategoryDto?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<CategoryDto> CreateAsync(CategoryCreateUpdateDto dto, CancellationToken ct = default);
    Task<CategoryDto?> UpdateAsync(Guid id, CategoryCreateUpdateDto dto, CancellationToken ct = default);
    Task<bool> DeleteAsync(Guid id, CancellationToken ct = default);
    Task<CategoryDto?> ReorderAsync(Guid id, string direction, CancellationToken ct = default);
}

public interface IProductTypeService
{
    Task<List<ProductTypeDto>> GetAllAsync(CancellationToken ct = default);
    Task<ProductTypeDto?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<ProductTypeDto> CreateAsync(ProductTypeCreateUpdateDto dto, CancellationToken ct = default);
    Task<ProductTypeDto?> UpdateAsync(Guid id, ProductTypeCreateUpdateDto dto, CancellationToken ct = default);
    Task<bool> DeleteAsync(Guid id, CancellationToken ct = default);

    Task<ProductTypeDto?> CreateFieldAsync(Guid productTypeId, FieldDefinitionCreateUpdateDto dto, CancellationToken ct = default);
    Task<ProductTypeDto?> UpdateFieldAsync(Guid productTypeId, Guid fieldId, FieldDefinitionCreateUpdateDto dto, CancellationToken ct = default);
    Task<ProductTypeDto?> DeleteFieldAsync(Guid productTypeId, Guid fieldId, CancellationToken ct = default);
}

public interface IDocumentDefinitionService
{
    Task<List<DocumentDefinitionDto>> GetAllAsync(Guid? productTypeId, CancellationToken ct = default);
    Task<DocumentDefinitionDto> CreateAsync(DocumentDefinitionCreateUpdateDto dto, CancellationToken ct = default);
    Task<DocumentDefinitionDto?> UpdateAsync(Guid id, DocumentDefinitionCreateUpdateDto dto, CancellationToken ct = default);
    Task<bool> DeleteAsync(Guid id, CancellationToken ct = default);
}

/// <summary>
/// Manages the catalog of status values (and their display metadata) for each entity type. This is
/// the source of truth for which status strings are valid on a real record - not a fixed enum - so
/// Create genuinely adds a new usable status, not just a label.
/// </summary>
public interface IStatusConfigService
{
    Task<List<StatusConfigDto>> GetAllAsync(string? entityType, CancellationToken ct = default);
    Task<StatusConfigDto> CreateAsync(StatusConfigCreateDto dto, CancellationToken ct = default);
    Task<StatusConfigDto?> UpdateAsync(Guid id, StatusConfigUpdateDto dto, CancellationToken ct = default);
    Task<bool> DeleteAsync(Guid id, CancellationToken ct = default);
}

public interface IEmploymentTypeService
{
    Task<List<EmploymentTypeDto>> GetAllAsync(bool? activeOnly = null, CancellationToken ct = default);
    Task<EmploymentTypeDto?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<EmploymentTypeDto> CreateAsync(EmploymentTypeCreateUpdateDto dto, CancellationToken ct = default);
    Task<EmploymentTypeDto?> UpdateAsync(Guid id, EmploymentTypeCreateUpdateDto dto, CancellationToken ct = default);
    Task<bool> DeleteAsync(Guid id, CancellationToken ct = default);
}

public interface IRankingConfigService
{
    Task<RankingConfigDto> GetConfigAsync(CancellationToken ct = default);
    Task<RankingConfigDto> UpdateConfigAsync(RankingConfigUpdateDto dto, CancellationToken ct = default);
}

public interface IProductService
{
    Task<PagedResult<ProductListItemDto>> SearchAsync(ProductQueryDto query, CancellationToken ct = default);
    Task<ProductDetailDto?> GetByIdAsync(Guid id, bool trackView, CancellationToken ct = default);
    Task<ProductDetailDto> CreateAsync(ProductCreateUpdateDto dto, CancellationToken ct = default);
    Task<ProductDetailDto?> UpdateAsync(Guid id, ProductCreateUpdateDto dto, CancellationToken ct = default);
    Task<bool> DeleteAsync(Guid id, CancellationToken ct = default);
    Task<ProductDetailDto?> UpdateStatusAsync(Guid id, string status, CancellationToken ct = default);
    Task<List<TopPerformerDto>> GetTopPerformersAsync(string metric, int take, CancellationToken ct = default);

    /// <summary>Every product matching the catalogue filters, as CSV, capped and reporting how many matched.</summary>
    Task<CsvExport> ExportCsvAsync(ProductQueryDto query, CancellationToken ct = default);
}

public interface IReviewService
{
    Task<PagedResult<ReviewDto>> SearchAsync(ReviewQueryDto query, CancellationToken ct = default);
    Task<ReviewDto?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<ReviewDto> CreateAsync(ReviewCreateDto dto, CancellationToken ct = default);
    Task<ReviewDto?> UpdateStatusAsync(Guid id, string status, CancellationToken ct = default);
    Task<bool> DeleteAsync(Guid id, CancellationToken ct = default);
}

public interface IPromotionService
{
    Task<PagedResult<PromotionDto>> SearchAsync(PromotionQueryDto query, CancellationToken ct = default);
    /// <summary>How many promotions hold each status under the search and product filters (the status filter is ignored).</summary>
    Task<IReadOnlyList<StatusCountDto>> StatusCountsAsync(PromotionQueryDto query, CancellationToken ct = default);
    Task<PromotionDto?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<PromotionDto> CreateAsync(PromotionCreateUpdateDto dto, CancellationToken ct = default);
    Task<PromotionDto?> UpdateAsync(Guid id, PromotionCreateUpdateDto dto, CancellationToken ct = default);
    Task<PromotionDto?> UpdateStatusAsync(Guid id, string status, CancellationToken ct = default);
    Task<bool> DeleteAsync(Guid id, CancellationToken ct = default);
}

public interface IApplicationService
{
    Task<PagedResult<ApplicationListItemDto>> SearchAsync(ApplicationQueryDto query, CancellationToken ct = default);
    /// <summary>How many applications hold each status under the search and product filters (the status filter is ignored).</summary>
    Task<IReadOnlyList<StatusCountDto>> StatusCountsAsync(ApplicationQueryDto query, CancellationToken ct = default);
    Task<ApplicationDetailDto?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<ApplicationDetailDto> CreateAsync(ApplicationCreateDto dto, CancellationToken ct = default);
    Task<ApplicationDetailDto?> UpdateStatusAsync(Guid id, ApplicationStatusUpdateDto dto, CancellationToken ct = default);
    Task<ApplicationDocumentDto?> UploadDocumentAsync(Guid applicationId, Guid documentId, string fileName, string contentType, long length, Stream content, CancellationToken ct = default);
    Task<(Stream Stream, string ContentType, string FileName)?> GetDocumentFileAsync(Guid applicationId, Guid documentId, CancellationToken ct = default);
    Task<ApplicationDocumentDto?> RemoveDocumentFileAsync(Guid applicationId, Guid documentId, CancellationToken ct = default);
}

/// <summary>Abstraction over where uploaded application-document files physically live. Backed by
/// local disk today (no cloud storage config exists anywhere in this app); swapping to blob storage
/// later only means a new implementation, no change to callers.</summary>
public interface IFileStorageService
{
    Task<string> SaveAsync(Guid applicationId, Guid documentId, string originalFileName, Stream content, CancellationToken ct = default);
    Task<Stream?> OpenReadAsync(string storagePath, CancellationToken ct = default);
    void Delete(string storagePath);
}

public interface IDashboardService
{
    Task<DashboardSummaryDto> GetSummaryAsync(CancellationToken ct = default);
    Task<List<TrendPointDto>> GetApplicationTrendAsync(int days, CancellationToken ct = default);
    Task<List<CategoryBreakdownDto>> GetApplicationsByCategoryAsync(CancellationToken ct = default);
    Task<List<StatusDistributionDto>> GetProductStatusDistributionAsync(CancellationToken ct = default);
    Task<List<TopProductDto>> GetTopProductsAsync(int take, CancellationToken ct = default);
    Task<List<RecentProductDto>> GetRecentProductsAsync(int take, CancellationToken ct = default);
    Task<List<KeyValuePair<string, int>>> GetTopSearchesAsync(int take, CancellationToken ct = default);
}

/// <summary>
/// Identifies who is performing the current request, from the verified platform token only — never from
/// anything the browser sends. During an approval replay it names the maker who requested the change.
/// </summary>
public interface IAuditContext
{
    Guid? UserId { get; }
    string ActorName { get; }
    string ActorEmail { get; }
    string? IpAddress { get; }
    string? UserAgent { get; }
}

/// <summary>
/// Copies an audit entry into the platform's central audit trail, so activity in this remote appears in
/// the host's Audit Logs and in each user's activity history. Best effort: a failure to forward never
/// fails the action that was already recorded locally.
/// </summary>
public interface IAuditForwarder
{
    Task ForwardAsync(AuditForwardEntry entry, CancellationToken ct = default);
}

public sealed record AuditForwardEntry(
    string Action,
    string EntityType,
    Guid? EntityId,
    string EntityName,
    string Description,
    bool Success,
    Guid? ActorUserId,
    string ActorName);

public interface IAuditLogService
{
    Task LogAsync(string action, string entityType, Guid? entityId, string entityName, string description,
        bool success = true, string? previousValue = null, string? newValue = null, CancellationToken ct = default);
    Task<PagedResult<AuditLogDto>> SearchAsync(AuditLogQueryDto query, CancellationToken ct = default);
    Task<AuditLogDto?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<List<AuditActionOptionDto>> GetActionOptionsAsync(CancellationToken ct = default);
    Task<AuditLogSummaryDto> GetSummaryAsync(AuditLogQueryDto query, CancellationToken ct = default);
    Task<List<string>> GetEntityTypesAsync(CancellationToken ct = default);

    /// <summary>The whole filtered trail as CSV, capped, reporting how many rows matched.</summary>
    Task<CsvExport> ExportCsvAsync(AuditLogQueryDto query, CancellationToken ct = default);
}
