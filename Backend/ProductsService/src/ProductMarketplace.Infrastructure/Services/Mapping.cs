using System.Text.Json;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Domain.Entities;

namespace ProductMarketplace.Infrastructure.Services;

public static class Mapping
{
    public static FieldDefinitionDto ToDto(this FieldDefinition f) => new()
    {
        Id = f.Id,
        SubCategoryId = f.SubCategoryId,
        Key = f.Key,
        Label = f.Label,
        DataType = f.DataType.ToString(),
        Unit = f.Unit,
        Options = string.IsNullOrEmpty(f.OptionsJson) ? null : JsonSerializer.Deserialize<List<string>>(f.OptionsJson),
        Validations = FieldRuleJson.Parse(f.ValidationsJson),
        Required = f.Required,
        Filterable = f.Filterable,
        Sortable = f.Sortable,
        DisplayOnCard = f.DisplayOnCard,
        DisplayOnDetails = f.DisplayOnDetails,
        IsReadOnly = f.IsReadOnly,
        IsPrimaryMetric = f.IsPrimaryMetric,
        IsSecondaryMetric = f.IsSecondaryMetric,
        SortOrder = f.SortOrder
    };

    public static ProductFieldValueDto ToDto(this ProductFieldValue v) => new()
    {
        FieldDefinitionId = v.FieldDefinitionId,
        Key = v.FieldDefinition?.Key ?? string.Empty,
        Label = v.FieldDefinition?.Label ?? string.Empty,
        DataType = v.FieldDefinition?.DataType.ToString() ?? string.Empty,
        Unit = v.FieldDefinition?.Unit,
        Value = v.Value,
        DisplayOnCard = v.FieldDefinition?.DisplayOnCard ?? false,
        DisplayOnDetails = v.FieldDefinition?.DisplayOnDetails ?? false,
        IsReadOnly = v.FieldDefinition?.IsReadOnly ?? false,
        IsPrimaryMetric = v.FieldDefinition?.IsPrimaryMetric ?? false,
        IsSecondaryMetric = v.FieldDefinition?.IsSecondaryMetric ?? false
    };

    public static ProductBenefitDto ToDto(this ProductBenefit b) => new() { Id = b.Id, Title = b.Title, Description = b.Description, IconKey = b.IconKey };

    public static ProductEligibilityDto ToDto(this ProductEligibility e) => new() { Id = e.Id, Criteria = e.Criteria, Description = e.Description };

    public static CategoryDto ToDto(this Category c, bool isLive, int subCategoryCount, int productCount) => new()
    {
        Id = c.Id,
        Name = c.Name,
        Code = c.Code,
        Description = c.Description,
        IconKey = c.IconKey,
        Status = c.Status,
        IsLive = isLive,
        DisplayOrder = c.DisplayOrder,
        SubCategoryCount = subCategoryCount,
        ProductCount = productCount,
        CreatedAt = c.CreatedAt
    };

    /// <summary>Needs <see cref="SubCategory.Category"/> loaded.</summary>
    public static SubCategoryDto ToDto(this SubCategory s, bool isLive, int productCount) => new()
    {
        Id = s.Id,
        CategoryId = s.CategoryId,
        CategoryName = s.Category?.Name ?? string.Empty,
        CategoryCode = s.Category?.Code ?? string.Empty,
        Name = s.Name,
        Code = s.Code,
        Description = s.Description,
        IconKey = s.IconKey,
        Status = s.Status,
        IsLive = isLive,
        DisplayOrder = s.DisplayOrder,
        ProductCount = productCount,
        CreatedAt = s.CreatedAt
    };

    /// <summary>Needs <see cref="SubCategory.Category"/> and <see cref="SubCategory.FieldDefinitions"/> loaded.</summary>
    public static SubCategoryDetailDto ToDetailDto(this SubCategory s, bool isLive, int productCount)
    {
        var summary = s.ToDto(isLive, productCount);
        return new SubCategoryDetailDto
        {
            Id = summary.Id,
            CategoryId = summary.CategoryId,
            CategoryName = summary.CategoryName,
            CategoryCode = summary.CategoryCode,
            Name = summary.Name,
            Code = summary.Code,
            Description = summary.Description,
            IconKey = summary.IconKey,
            Status = summary.Status,
            IsLive = summary.IsLive,
            DisplayOrder = summary.DisplayOrder,
            ProductCount = summary.ProductCount,
            CreatedAt = summary.CreatedAt,
            FieldDefinitions = s.FieldDefinitions.OrderBy(f => f.SortOrder).Select(f => f.ToDto()).ToList()
        };
    }

    public static DocumentDefinitionDto ToDto(this DocumentDefinition d) => new()
    {
        Id = d.Id,
        Name = d.Name,
        DocumentType = d.DocumentType,
        Required = d.Required,
        SortOrder = d.SortOrder,
        Active = d.Active,
        SubCategoryId = d.SubCategoryId,
        SubCategoryName = d.SubCategory?.Name,
        CreatedAt = d.CreatedAt
    };

    public static StatusConfigDto ToDto(this StatusConfig s) => new()
    {
        Id = s.Id,
        EntityType = s.EntityType,
        Value = s.Value,
        Label = s.Label,
        Color = s.Color,
        Enabled = s.Enabled,
        IsLive = s.IsLive,
        SortOrder = s.SortOrder
    };

    public static AuditLogDto ToDto(this AuditLog a) => new()
    {
        Id = a.Id,
        Timestamp = a.Timestamp,
        ActorName = a.ActorName,
        ActorUserId = a.ActorUserId,
        ActorEmail = a.ActorEmail,
        Action = a.Action,
        EntityType = a.EntityType,
        EntityId = a.EntityId,
        EntityName = a.EntityName,
        Description = a.Description,
        Success = a.Success,
        PreviousValue = a.PreviousValue,
        NewValue = a.NewValue,
        IpAddress = a.IpAddress
    };

    /// <summary>Needs the product's sub-category and that sub-category's category loaded.</summary>
    internal static ProductListItemDto ToListItemDto(this Product p, CatalogVisibility visibility) => new()
    {
        Id = p.Id,
        Name = p.Name,
        Code = p.Code,
        ShortDescription = p.ShortDescription,
        IconKey = p.IconKey,
        Status = p.Status,
        IsVisible = visibility.IsVisible(p),
        CategoryId = p.SubCategory.CategoryId,
        CategoryName = p.SubCategory.Category.Name,
        SubCategoryId = p.SubCategoryId,
        SubCategoryName = p.SubCategory.Name,
        SubCategoryCode = p.SubCategory.Code,
        CardFields = p.FieldValues.Where(v => v.FieldDefinition != null && v.FieldDefinition.DisplayOnCard).OrderBy(v => v.FieldDefinition.SortOrder).Select(v => v.ToDto()).ToList(),
        FeatureTags = p.Benefits.OrderBy(b => b.SortOrder).Select(b => b.Title).ToList(),
        CreatedAt = p.CreatedAt,
        UpdatedAt = p.UpdatedAt
    };

    internal static ProductDetailDto ToDetailDto(this Product p, CatalogVisibility visibility)
    {
        var list = p.ToListItemDto(visibility);
        return new ProductDetailDto
        {
            Id = list.Id,
            Name = list.Name,
            Code = list.Code,
            ShortDescription = list.ShortDescription,
            IconKey = list.IconKey,
            Status = list.Status,
            IsVisible = list.IsVisible,
            CategoryId = list.CategoryId,
            CategoryName = list.CategoryName,
            SubCategoryId = list.SubCategoryId,
            SubCategoryName = list.SubCategoryName,
            SubCategoryCode = list.SubCategoryCode,
            CardFields = list.CardFields,
            FeatureTags = list.FeatureTags,
            CreatedAt = list.CreatedAt,
            UpdatedAt = list.UpdatedAt,
            Description = p.Description,
            ViewCount = p.ViewCount,
            DetailFields = p.FieldValues.Where(v => v.FieldDefinition != null && v.FieldDefinition.DisplayOnDetails).OrderBy(v => v.FieldDefinition.SortOrder).Select(v => v.ToDto()).ToList(),
            Benefits = p.Benefits.OrderBy(b => b.SortOrder).Select(b => b.ToDto()).ToList(),
            EligibilityCriteria = p.EligibilityCriteria.OrderBy(e => e.SortOrder).Select(e => e.ToDto()).ToList()
        };
    }
}
