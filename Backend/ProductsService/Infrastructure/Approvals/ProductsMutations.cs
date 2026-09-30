using System.Text.Json;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;

namespace ProductMarketplace.Api.Infrastructure.Approvals;

/// <summary>One change this service can hold for approval and later replay.</summary>
/// <param name="Operation">Stable identifier stored with the request; how a replay finds its handler.</param>
/// <param name="Module">The capability module, so the approval is filed under <c>remote.{appKey}.{Module}</c>.</param>
/// <param name="Action">What the Approval Center shows: Create, Update or Delete.</param>
/// <param name="EntityType">A plain name for the record kind ("Product").</param>
public sealed record ProductsMutation(string Operation, string Module, string Action, string EntityType);

/// <summary>
/// Every change in Products & Marketplace that goes through maker-checker, and how each is applied.
/// </summary>
/// <remarks>
/// Gating and replay are defined together, in one table, so a change cannot be made approvable without
/// also being replayable — the failure that mode would produce is an approved request that silently
/// does nothing. <see cref="ApplyAsync"/> calls the very same service method a direct request would, so an
/// approved change is re-validated against the database as it is at approval time.
/// </remarks>
public static class ProductsMutations
{
    public static readonly ProductsMutation ProductCreate = new("product.create", "products", "Create", "Product");
    public static readonly ProductsMutation ProductUpdate = new("product.update", "products", "Update", "Product");
    public static readonly ProductsMutation ProductStatus = new("product.status", "products", "Update", "Product");
    public static readonly ProductsMutation ProductDelete = new("product.delete", "products", "Delete", "Product");

    public static readonly ProductsMutation CategoryCreate = new("category.create", "categories", "Create", "Category");
    public static readonly ProductsMutation CategoryUpdate = new("category.update", "categories", "Update", "Category");
    public static readonly ProductsMutation CategoryReorder = new("category.reorder", "categories", "Update", "Category");
    public static readonly ProductsMutation CategoryDelete = new("category.delete", "categories", "Delete", "Category");

    public static readonly ProductsMutation SubCategoryCreate = new("sub_category.create", "subcategories", "Create", "Sub-category");
    public static readonly ProductsMutation SubCategoryUpdate = new("sub_category.update", "subcategories", "Update", "Sub-category");
    public static readonly ProductsMutation SubCategoryReorder = new("sub_category.reorder", "subcategories", "Update", "Sub-category");
    public static readonly ProductsMutation SubCategoryDelete = new("sub_category.delete", "subcategories", "Delete", "Sub-category");

    public static readonly ProductsMutation FieldCreate = new("field.create", "setup", "Create", "Product field");
    public static readonly ProductsMutation FieldUpdate = new("field.update", "setup", "Update", "Product field");
    public static readonly ProductsMutation FieldDelete = new("field.delete", "setup", "Delete", "Product field");
    public static readonly ProductsMutation DocumentDefinitionCreate = new("document_definition.create", "setup", "Create", "Required document");
    public static readonly ProductsMutation DocumentDefinitionUpdate = new("document_definition.update", "setup", "Update", "Required document");
    public static readonly ProductsMutation DocumentDefinitionDelete = new("document_definition.delete", "setup", "Delete", "Required document");
    public static readonly ProductsMutation StatusConfigCreate = new("status_config.create", "setup", "Create", "Status");
    public static readonly ProductsMutation StatusConfigUpdate = new("status_config.update", "setup", "Update", "Status");
    public static readonly ProductsMutation StatusConfigDelete = new("status_config.delete", "setup", "Delete", "Status");

    public static readonly IReadOnlyList<ProductsMutation> All = typeof(ProductsMutations)
        .GetFields(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static)
        .Where(f => f.FieldType == typeof(ProductsMutation))
        .Select(f => (ProductsMutation)f.GetValue(null)!)
        .ToList();

    public static ProductsMutation? Find(string operation) => All.FirstOrDefault(m => m.Operation == operation);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static T Body<T>(JsonElement payload) =>
        payload.Deserialize<T>(Json) ?? throw new InvalidOperationException("The approved change had no content to apply.");

    private static Guid Id(string? entityId) =>
        Guid.TryParse(entityId, out var id) ? id : throw new InvalidOperationException("The approved change did not name the record it applies to.");

    /// <summary>For changes to a child record (a field of a sub-category): "parentId/childId".</summary>
    private static (Guid Parent, Guid Child) Ids(string? entityId)
    {
        var parts = (entityId ?? string.Empty).Split('/', 2);
        return parts.Length == 2 && Guid.TryParse(parts[0], out var parent) && Guid.TryParse(parts[1], out var child)
            ? (parent, child)
            : throw new InvalidOperationException("The approved change did not name the record it applies to.");
    }

    private static void Found(object? result, string what)
    {
        if (result is null or false)
        {
            throw new InvalidOperationException($"The {what} this change applies to no longer exists, so it could not be applied.");
        }
    }

    /// <summary>Applies an approved change through the same service method a direct request uses.</summary>
    public static async Task ApplyAsync(IServiceProvider sp, string operation, string? entityId, JsonElement payload, CancellationToken ct)
    {
        T S<T>() where T : notnull => sp.GetRequiredService<T>();

        switch (operation)
        {
            case "product.create": await S<IProductService>().CreateAsync(Body<ProductCreateUpdateDto>(payload), ct); break;
            case "product.update": Found(await S<IProductService>().UpdateAsync(Id(entityId), Body<ProductCreateUpdateDto>(payload), ct), "product"); break;
            case "product.status": Found(await S<IProductService>().UpdateStatusAsync(Id(entityId), Body<ProductStatusUpdateDto>(payload).Status, ct), "product"); break;
            case "product.delete": Found(await S<IProductService>().DeleteAsync(Id(entityId), ct), "product"); break;

            case "category.create": await S<ICategoryService>().CreateAsync(Body<CategoryCreateUpdateDto>(payload), ct); break;
            case "category.update": Found(await S<ICategoryService>().UpdateAsync(Id(entityId), Body<CategoryCreateUpdateDto>(payload), ct), "category"); break;
            case "category.reorder": Found(await S<ICategoryService>().ReorderAsync(Id(entityId), Body<CategoryReorderDto>(payload).Direction, ct), "category"); break;
            case "category.delete": Found(await S<ICategoryService>().DeleteAsync(Id(entityId), ct), "category"); break;

            case "sub_category.create": await S<ISubCategoryService>().CreateAsync(Body<SubCategoryCreateUpdateDto>(payload), ct); break;
            case "sub_category.update": Found(await S<ISubCategoryService>().UpdateAsync(Id(entityId), Body<SubCategoryCreateUpdateDto>(payload), ct), "sub-category"); break;
            case "sub_category.reorder": Found(await S<ISubCategoryService>().ReorderAsync(Id(entityId), Body<CategoryReorderDto>(payload).Direction, ct), "sub-category"); break;
            case "sub_category.delete": Found(await S<ISubCategoryService>().DeleteAsync(Id(entityId), ct), "sub-category"); break;

            case "field.create": Found(await S<ISubCategoryService>().CreateFieldAsync(Id(entityId), Body<FieldDefinitionCreateUpdateDto>(payload), ct), "sub-category"); break;
            case "field.update":
            {
                var (subCategoryId, fieldId) = Ids(entityId);
                Found(await S<ISubCategoryService>().UpdateFieldAsync(subCategoryId, fieldId, Body<FieldDefinitionCreateUpdateDto>(payload), ct), "field");
                break;
            }
            case "field.delete":
            {
                var (subCategoryId, fieldId) = Ids(entityId);
                Found(await S<ISubCategoryService>().DeleteFieldAsync(subCategoryId, fieldId, ct), "field");
                break;
            }

            case "document_definition.create": await S<IDocumentDefinitionService>().CreateAsync(Body<DocumentDefinitionCreateUpdateDto>(payload), ct); break;
            case "document_definition.update": Found(await S<IDocumentDefinitionService>().UpdateAsync(Id(entityId), Body<DocumentDefinitionCreateUpdateDto>(payload), ct), "required document"); break;
            case "document_definition.delete": Found(await S<IDocumentDefinitionService>().DeleteAsync(Id(entityId), ct), "required document"); break;

            case "status_config.create": await S<IStatusConfigService>().CreateAsync(Body<StatusConfigCreateDto>(payload), ct); break;
            case "status_config.update": Found(await S<IStatusConfigService>().UpdateAsync(Id(entityId), Body<StatusConfigUpdateDto>(payload), ct), "status"); break;
            case "status_config.delete": Found(await S<IStatusConfigService>().DeleteAsync(Id(entityId), ct), "status"); break;

            default:
                throw new InvalidOperationException($"This service does not know how to apply '{operation}'.");
        }
    }
}
