using OmniConnect.Validation;
using ProductMarketplace.Application.Common;
using ProductMarketplace.Application.Dtos;

namespace ProductMarketplace.Application.Interfaces;

public interface ICategoryService
{
    Task<PagedResult<CategoryDto>> SearchAsync(CategoryQueryDto query, CancellationToken ct = default);
    Task<CategoryDto?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<CategoryDto> CreateAsync(CategoryCreateUpdateDto dto, CancellationToken ct = default);
    Task<CategoryDto?> UpdateAsync(Guid id, CategoryCreateUpdateDto dto, CancellationToken ct = default);
    Task<bool> DeleteAsync(Guid id, CancellationToken ct = default);
    Task<CategoryDto?> ReorderAsync(Guid id, string direction, CancellationToken ct = default);
}

public interface ISubCategoryService
{
    Task<PagedResult<SubCategoryDto>> SearchAsync(SubCategoryQueryDto query, CancellationToken ct = default);
    Task<SubCategoryDetailDto?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<SubCategoryDetailDto> CreateAsync(SubCategoryCreateUpdateDto dto, CancellationToken ct = default);
    Task<SubCategoryDetailDto?> UpdateAsync(Guid id, SubCategoryCreateUpdateDto dto, CancellationToken ct = default);
    Task<bool> DeleteAsync(Guid id, CancellationToken ct = default);
    Task<SubCategoryDetailDto?> ReorderAsync(Guid id, string direction, CancellationToken ct = default);

    Task<SubCategoryDetailDto?> CreateFieldAsync(Guid subCategoryId, FieldDefinitionCreateUpdateDto dto, CancellationToken ct = default);
    Task<SubCategoryDetailDto?> UpdateFieldAsync(Guid subCategoryId, Guid fieldId, FieldDefinitionCreateUpdateDto dto, CancellationToken ct = default);
    Task<SubCategoryDetailDto?> DeleteFieldAsync(Guid subCategoryId, Guid fieldId, CancellationToken ct = default);
}

public interface IDocumentDefinitionService
{
    /// <summary>With no sub-category: the whole catalog. With one: what applies to it — scoped to it, plus the ones that apply to everything.</summary>
    Task<List<DocumentDefinitionDto>> GetAllAsync(Guid? subCategoryId, CancellationToken ct = default);
    Task<DocumentDefinitionDto> CreateAsync(DocumentDefinitionCreateUpdateDto dto, CancellationToken ct = default);
    Task<DocumentDefinitionDto?> UpdateAsync(Guid id, DocumentDefinitionCreateUpdateDto dto, CancellationToken ct = default);
    Task<bool> DeleteAsync(Guid id, CancellationToken ct = default);
}

/// <summary>
/// Manages the catalog of status values (and their display metadata and meaning) for each entity type. This
/// is the source of truth for which status strings are valid on a real record - not a fixed enum - so
/// Create genuinely adds a new usable status, not just a label.
/// </summary>
public interface IStatusConfigService
{
    Task<List<StatusConfigDto>> GetAllAsync(string? entityType, CancellationToken ct = default);
    Task<StatusConfigDto> CreateAsync(StatusConfigCreateDto dto, CancellationToken ct = default);
    Task<StatusConfigDto?> UpdateAsync(Guid id, StatusConfigUpdateDto dto, CancellationToken ct = default);
    Task<bool> DeleteAsync(Guid id, CancellationToken ct = default);
}

/// <summary>
/// Answers "which statuses make a record live?" from Setup, so nothing in the catalogue compares a
/// status to a literal like "Active".
/// </summary>
/// <remarks>
/// Read once per request and reused: a request that filters products, and then reports on them, would
/// otherwise ask the same three-row question repeatedly. It is deliberately not cached across requests —
/// a change made in Setup takes effect on the next request on every instance, which an in-process cache
/// cannot promise once there is more than one.
/// </remarks>
public interface ICatalogStatuses
{
    /// <summary>The status values of <paramref name="entityType"/> that make a record live.</summary>
    Task<IReadOnlyCollection<string>> LiveValuesAsync(string entityType, CancellationToken ct = default);
}

/// <summary>The admin-defined formats (Settings → Manage Formats) a field rule may refer to.</summary>
public interface IFormatPresetSource
{
    /// <summary>Never throws for an unreachable source: an outage of the settings service must not stop products being saved.</summary>
    Task<IReadOnlyList<FormatPreset>> GetAsync(CancellationToken ct = default);
}

public interface IProductService
{
    Task<PagedResult<ProductListItemDto>> SearchAsync(ProductQueryDto query, CancellationToken ct = default);
    /// <summary>Products per status under the other catalogue filters (the status filter is ignored).</summary>
    Task<IReadOnlyList<StatusCountDto>> StatusCountsAsync(ProductQueryDto query, CancellationToken ct = default);
    Task<ProductDetailDto?> GetByIdAsync(Guid id, bool trackView, CancellationToken ct = default);
    Task<ProductDetailDto> CreateAsync(ProductCreateUpdateDto dto, CancellationToken ct = default);
    Task<ProductDetailDto?> UpdateAsync(Guid id, ProductCreateUpdateDto dto, CancellationToken ct = default);
    Task<bool> DeleteAsync(Guid id, CancellationToken ct = default);
    Task<ProductDetailDto?> UpdateStatusAsync(Guid id, string status, CancellationToken ct = default);

    /// <summary>Every product matching the catalogue filters, as CSV, capped and reporting how many matched.</summary>
    Task<CsvExport> ExportCsvAsync(ProductQueryDto query, CancellationToken ct = default);
}

/// <summary>
/// Read-only view of the catalogue for other services — today, Lead Management's product picker. Every
/// answer is limited to what the catalogue currently shows, so a category switched off in Setup vanishes
/// from the caller without the caller knowing anything about statuses.
/// </summary>
public interface ICatalogLookupService
{
    Task<List<CatalogCategoryLookupDto>> GetCategoriesAsync(CancellationToken ct = default);
    Task<List<CatalogSubCategoryLookupDto>> GetSubCategoriesAsync(CancellationToken ct = default);
    Task<List<CatalogProductLookupDto>> GetProductsAsync(Guid categoryId, CancellationToken ct = default);

    /// <summary>Null when the product does not exist or is not currently shown.</summary>
    Task<CatalogProductLookupDto?> GetProductAsync(Guid productId, CancellationToken ct = default);
}

public interface IDashboardService
{
    /// <param name="comparedDays">How far back the "change" on each figure looks.</param>
    Task<DashboardSummaryDto> GetSummaryAsync(int comparedDays, CancellationToken ct = default);

    /// <summary>Products per category; or per sub-category when <paramref name="categoryId"/> names one.</summary>
    Task<List<CatalogBreakdownDto>> GetProductBreakdownAsync(Guid? categoryId, CancellationToken ct = default);
    Task<List<StatusDistributionDto>> GetProductStatusDistributionAsync(CancellationToken ct = default);
    Task<List<RecentProductDto>> GetRecentProductsAsync(int take, CancellationToken ct = default);
    Task<List<RecentActivityDto>> GetRecentActivityAsync(int take, CancellationToken ct = default);
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
