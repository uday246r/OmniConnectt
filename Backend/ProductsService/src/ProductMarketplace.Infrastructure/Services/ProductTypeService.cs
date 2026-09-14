using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Application.Common;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;
using ProductMarketplace.Domain.Entities;
using ProductMarketplace.Domain.Enums;
using ProductMarketplace.Infrastructure.Data;

namespace ProductMarketplace.Infrastructure.Services;

public class ProductTypeService : IProductTypeService
{
    private readonly AppDbContext _db;
    private readonly IAuditLogService _audit;
    public ProductTypeService(AppDbContext db, IAuditLogService audit)
    {
        _db = db;
        _audit = audit;
    }

    private IQueryable<ProductType> Base() => _db.ProductTypes
        .Include(t => t.FieldDefinitions)
        .Include(t => t.Products);

    public async Task<List<ProductTypeDto>> GetAllAsync(CancellationToken ct = default)
    {
        var types = await Base().OrderBy(t => t.Name).ToListAsync(ct);
        return types.Select(t => t.ToDto()).ToList();
    }

    public async Task<ProductTypeDto?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        var type = await Base().FirstOrDefaultAsync(t => t.Id == id, ct);
        return type?.ToDto();
    }

    public async Task<ProductTypeDto> CreateAsync(ProductTypeCreateUpdateDto dto, CancellationToken ct = default)
    {
        var code = Slugify(dto.Code.Length > 0 ? dto.Code : dto.Name);
        if (await _db.ProductTypes.AnyAsync(t => t.Code == code, ct))
            throw new InvalidOperationException($"A product type with code \"{code}\" already exists.");

        var type = new ProductType
        {
            Name = dto.Name,
            Code = code,
            IconKey = dto.IconKey,
            ApplyButtonLabel = string.IsNullOrWhiteSpace(dto.ApplyButtonLabel) ? "Apply Now" : dto.ApplyButtonLabel.Trim(),
            AmountFieldLabel = string.IsNullOrWhiteSpace(dto.AmountFieldLabel) ? "Requested Amount" : dto.AmountFieldLabel.Trim(),
            ShortLabel = dto.ShortLabel?.Trim() ?? string.Empty
        };
        _db.ProductTypes.Add(type);
        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(AuditActions.CreateProductType, AuditEntityTypes.ProductType, type.Id, type.Name, $"Created product type \"{type.Name}\"", ct: ct);
        return (await Base().FirstAsync(t => t.Id == type.Id, ct)).ToDto();
    }

    public async Task<ProductTypeDto?> UpdateAsync(Guid id, ProductTypeCreateUpdateDto dto, CancellationToken ct = default)
    {
        var type = await _db.ProductTypes.FirstOrDefaultAsync(t => t.Id == id, ct);
        if (type is null) return null;

        var code = Slugify(dto.Code.Length > 0 ? dto.Code : dto.Name);
        if (await _db.ProductTypes.AnyAsync(t => t.Code == code && t.Id != id, ct))
            throw new InvalidOperationException($"A product type with code \"{code}\" already exists.");

        type.Name = dto.Name;
        type.Code = code;
        type.IconKey = dto.IconKey;
        type.ApplyButtonLabel = string.IsNullOrWhiteSpace(dto.ApplyButtonLabel) ? "Apply Now" : dto.ApplyButtonLabel.Trim();
        type.AmountFieldLabel = string.IsNullOrWhiteSpace(dto.AmountFieldLabel) ? "Requested Amount" : dto.AmountFieldLabel.Trim();
        type.ShortLabel = dto.ShortLabel?.Trim() ?? string.Empty;
        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(AuditActions.UpdateProductType, AuditEntityTypes.ProductType, type.Id, type.Name, $"Updated product type \"{type.Name}\"", ct: ct);
        return (await Base().FirstAsync(t => t.Id == id, ct)).ToDto();
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var type = await _db.ProductTypes.Include(t => t.Products).FirstOrDefaultAsync(t => t.Id == id, ct);
        if (type is null) return false;
        if (type.Products.Count > 0)
            throw new InvalidOperationException("Cannot delete a product type that has products assigned to it.");

        _db.ProductTypes.Remove(type);
        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(AuditActions.DeleteProductType, AuditEntityTypes.ProductType, id, type.Name, $"Deleted product type \"{type.Name}\"", ct: ct);
        return true;
    }

    public async Task<ProductTypeDto?> CreateFieldAsync(Guid productTypeId, FieldDefinitionCreateUpdateDto dto, CancellationToken ct = default)
    {
        var type = await _db.ProductTypes.Include(t => t.FieldDefinitions).FirstOrDefaultAsync(t => t.Id == productTypeId, ct);
        if (type is null) return null;

        var key = Slugify(dto.Key.Length > 0 ? dto.Key : dto.Label).Replace("-", "_");
        if (type.FieldDefinitions.Any(f => f.Key == key))
            throw new InvalidOperationException($"A field with key \"{key}\" already exists on this product type.");

        var field = new FieldDefinition
        {
            ProductTypeId = productTypeId,
            Key = key,
            Label = dto.Label,
            DataType = Enum.Parse<FieldDataType>(dto.DataType, true),
            Unit = dto.Unit,
            OptionsJson = SerializeOptions(dto.Options),
            Required = dto.Required,
            Filterable = dto.Filterable,
            VisibleToCustomer = dto.VisibleToCustomer,
            Sortable = dto.Sortable,
            DisplayOnCard = dto.DisplayOnCard,
            DisplayOnDetails = dto.DisplayOnDetails,
            DisplayInApplication = dto.DisplayInApplication,
            IsReadOnly = dto.IsReadOnly,
            IsPrimaryMetric = dto.IsPrimaryMetric,
            IsSecondaryMetric = dto.IsSecondaryMetric,
            SortOrder = dto.SortOrder > 0 ? dto.SortOrder : type.FieldDefinitions.Count + 1
        };
        _db.FieldDefinitions.Add(field);
        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(AuditActions.CreateField, AuditEntityTypes.FieldDefinition, field.Id, field.Label, $"Added field \"{field.Label}\" to product type \"{type.Name}\"", ct: ct);
        return (await Base().FirstAsync(t => t.Id == productTypeId, ct)).ToDto();
    }

    public async Task<ProductTypeDto?> UpdateFieldAsync(Guid productTypeId, Guid fieldId, FieldDefinitionCreateUpdateDto dto, CancellationToken ct = default)
    {
        var type = await _db.ProductTypes.Include(t => t.FieldDefinitions).FirstOrDefaultAsync(t => t.Id == productTypeId, ct);
        if (type is null) return null;
        var field = type.FieldDefinitions.FirstOrDefault(f => f.Id == fieldId);
        if (field is null) return null;

        var key = Slugify(dto.Key.Length > 0 ? dto.Key : dto.Label).Replace("-", "_");
        if (type.FieldDefinitions.Any(f => f.Key == key && f.Id != fieldId))
            throw new InvalidOperationException($"A field with key \"{key}\" already exists on this product type.");

        field.Key = key;
        field.Label = dto.Label;
        field.DataType = Enum.Parse<FieldDataType>(dto.DataType, true);
        field.Unit = dto.Unit;
        field.OptionsJson = SerializeOptions(dto.Options);
        field.Required = dto.Required;
        field.Filterable = dto.Filterable;
        field.VisibleToCustomer = dto.VisibleToCustomer;
        field.Sortable = dto.Sortable;
        field.DisplayOnCard = dto.DisplayOnCard;
        field.DisplayOnDetails = dto.DisplayOnDetails;
        field.DisplayInApplication = dto.DisplayInApplication;
        field.IsReadOnly = dto.IsReadOnly;
        field.IsPrimaryMetric = dto.IsPrimaryMetric;
        field.IsSecondaryMetric = dto.IsSecondaryMetric;
        field.SortOrder = dto.SortOrder;

        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(AuditActions.UpdateField, AuditEntityTypes.FieldDefinition, field.Id, field.Label, $"Updated field \"{field.Label}\" on product type \"{type.Name}\"", ct: ct);
        return (await Base().FirstAsync(t => t.Id == productTypeId, ct)).ToDto();
    }

    public async Task<ProductTypeDto?> DeleteFieldAsync(Guid productTypeId, Guid fieldId, CancellationToken ct = default)
    {
        var type = await _db.ProductTypes.Include(t => t.FieldDefinitions).FirstOrDefaultAsync(t => t.Id == productTypeId, ct);
        if (type is null) return null;
        var field = type.FieldDefinitions.FirstOrDefault(f => f.Id == fieldId);
        if (field is null) return null;

        var inUse = await _db.ProductFieldValues.AnyAsync(v => v.FieldDefinitionId == fieldId, ct);
        if (inUse)
            throw new InvalidOperationException($"Cannot delete field \"{field.Label}\" - it is currently set on one or more products. Remove it from those products first.");

        _db.FieldDefinitions.Remove(field);
        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(AuditActions.DeleteField, AuditEntityTypes.FieldDefinition, fieldId, field.Label, $"Removed field \"{field.Label}\" from product type \"{type.Name}\"", ct: ct);
        return (await Base().FirstAsync(t => t.Id == productTypeId, ct)).ToDto();
    }

    private static string? SerializeOptions(List<string>? options) =>
        options is { Count: > 0 } ? JsonSerializer.Serialize(options) : null;

    private static string Slugify(string value) => value.Trim().ToLowerInvariant().Replace(" ", "-").Replace("&", "and");
}
