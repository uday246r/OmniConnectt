using System.Text.Json;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Domain.Entities;
using ProductMarketplace.Domain.Enums;
using DomainApplication = ProductMarketplace.Domain.Entities.Application;

namespace ProductMarketplace.Infrastructure.Services;

public static class Mapping
{
    public static FieldDefinitionDto ToDto(this FieldDefinition f) => new()
    {
        Id = f.Id,
        Key = f.Key,
        Label = f.Label,
        DataType = f.DataType.ToString(),
        Unit = f.Unit,
        Options = string.IsNullOrEmpty(f.OptionsJson) ? null : JsonSerializer.Deserialize<List<string>>(f.OptionsJson),
        Required = f.Required,
        Filterable = f.Filterable,
        VisibleToCustomer = f.VisibleToCustomer,
        Sortable = f.Sortable,
        DisplayOnCard = f.DisplayOnCard,
        DisplayOnDetails = f.DisplayOnDetails,
        DisplayInApplication = f.DisplayInApplication,
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

    public static ReviewDto ToDto(this Review r) => new()
    {
        Id = r.Id,
        ProductId = r.ProductId,
        ProductName = r.Product?.Name ?? string.Empty,
        CustomerName = r.CustomerName,
        CustomerEmail = r.CustomerEmail,
        Rating = r.Rating,
        Comment = r.Comment,
        Status = r.Status.ToString(),
        CreatedAt = r.CreatedAt
    };

    public static PromotionDto ToDto(this Promotion p) => new()
    {
        Id = p.Id,
        ProductId = p.ProductId,
        ProductName = p.Product?.Name ?? string.Empty,
        ProductCategoryName = p.Product?.Category?.Name ?? string.Empty,
        Title = p.Title,
        Description = p.Description,
        BadgeText = p.BadgeText,
        OfferDetail = p.OfferDetail,
        TermsAndConditions = p.TermsAndConditions,
        StartDate = p.StartDate,
        EndDate = p.EndDate,
        Priority = p.Priority,
        Status = p.Status.ToString()
    };

    public static CategoryDto ToDto(this Category c) => new()
    {
        Id = c.Id,
        Name = c.Name,
        Slug = c.Slug,
        Description = c.Description,
        IconKey = c.IconKey,
        Status = c.Status.ToString(),
        DisplayOrder = c.DisplayOrder,
        ProductCount = c.Products?.Count ?? 0,
        SubCategoryCount = c.SubCategories?.Count ?? 0,
        CreatedAt = c.CreatedAt
    };

    public static ProductTypeDto ToDto(this ProductType t) => new()
    {
        Id = t.Id,
        Name = t.Name,
        Code = t.Code,
        IconKey = t.IconKey,
        ApplyButtonLabel = t.ApplyButtonLabel,
        AmountFieldLabel = t.AmountFieldLabel,
        ShortLabel = t.ShortLabel,
        ProductCount = t.Products?.Count ?? 0,
        FieldDefinitions = t.FieldDefinitions.OrderBy(f => f.SortOrder).Select(f => f.ToDto()).ToList()
    };

    public static EmploymentTypeDto ToDto(this EmploymentType e) => new()
    {
        Id = e.Id,
        Name = e.Name,
        Active = e.Active,
        SortOrder = e.SortOrder,
        CreatedAt = e.CreatedAt,
        UpdatedAt = e.UpdatedAt
    };

    public static RankingConfigDto ToDto(this RankingConfig r) => new()
    {
        Id = r.Id,
        TrendingViewWeight = r.TrendingViewWeight,
        TrendingApplicationWeight = r.TrendingApplicationWeight,
        RecommendedRatingWeight = r.RecommendedRatingWeight,
        RecommendedApplicationWeight = r.RecommendedApplicationWeight,
        RecommendedPromotionWeight = r.RecommendedPromotionWeight,
        UpdatedAt = r.UpdatedAt
    };

    public static DocumentDefinitionDto ToDto(this DocumentDefinition d) => new()
    {
        Id = d.Id,
        Name = d.Name,
        DocumentType = d.DocumentType,
        Required = d.Required,
        SortOrder = d.SortOrder,
        Active = d.Active,
        ProductTypeId = d.ProductTypeId,
        ProductTypeName = d.ProductType?.Name,
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
        SortOrder = s.SortOrder
    };

    public static AuditLogDto ToDto(this AuditLog a) => new()
    {
        Id = a.Id,
        Timestamp = a.Timestamp,
        ActorName = a.ActorName,
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

    public static bool IsPromotionActive(this Promotion p, DateTime now) =>
        p.Status == "Active" && p.StartDate <= now && p.EndDate >= now;

    public static ProductListItemDto ToListItemDto(this Product p, DateTime now)
    {
        var activePromo = p.Promotions?.Where(x => x.IsPromotionActive(now)).OrderByDescending(x => x.Priority).FirstOrDefault();
        return new ProductListItemDto
        {
            Id = p.Id,
            Name = p.Name,
            Code = p.Code,
            ShortDescription = p.ShortDescription,
            IconKey = p.IconKey,
            Status = p.Status.ToString(),
            CategoryId = p.CategoryId,
            CategoryName = p.Category?.Name ?? string.Empty,
            ProductTypeId = p.ProductTypeId,
            ProductTypeName = p.ProductType?.Name ?? string.Empty,
            ProductTypeCode = p.ProductType?.Code ?? string.Empty,
            ProductTypeShortLabel = string.IsNullOrEmpty(p.ProductType?.ShortLabel) ? (p.ProductType?.Name ?? string.Empty) : p.ProductType.ShortLabel,
            ApplyButtonLabel = string.IsNullOrEmpty(p.ProductType?.ApplyButtonLabel) ? "Apply Now" : p.ProductType.ApplyButtonLabel,
            AmountFieldLabel = string.IsNullOrEmpty(p.ProductType?.AmountFieldLabel) ? "Requested Amount" : p.ProductType.AmountFieldLabel,
            RatingAverage = p.RatingAverage,
            RatingCount = p.RatingCount,
            ApplicationCount = p.ApplicationCount,
            CardFields = p.FieldValues?.Where(v => v.FieldDefinition != null && v.FieldDefinition.DisplayOnCard).OrderBy(v => v.FieldDefinition?.SortOrder ?? 0).Select(v => v.ToDto()).ToList() ?? new(),
            FeatureTags = p.Benefits?.OrderBy(b => b.SortOrder).Take(2).Select(b => b.Title).ToList() ?? new(),
            ActivePromotion = activePromo?.ToDto(),
            CreatedAt = p.CreatedAt,
            UpdatedAt = p.UpdatedAt
        };
    }

    public static ProductDetailDto ToDetailDto(this Product p, DateTime now)
    {
        var list = p.ToListItemDto(now);
        return new ProductDetailDto
        {
            Id = list.Id,
            Name = list.Name,
            Code = list.Code,
            ShortDescription = list.ShortDescription,
            IconKey = list.IconKey,
            Status = list.Status,
            CategoryId = list.CategoryId,
            CategoryName = list.CategoryName,
            ProductTypeId = list.ProductTypeId,
            ProductTypeName = list.ProductTypeName,
            ProductTypeCode = list.ProductTypeCode,
            RatingAverage = list.RatingAverage,
            RatingCount = list.RatingCount,
            ApplicationCount = list.ApplicationCount,
            CardFields = list.CardFields,
            FeatureTags = list.FeatureTags,
            ActivePromotion = list.ActivePromotion,
            CreatedAt = list.CreatedAt,
            UpdatedAt = list.UpdatedAt,
            Description = p.Description,
            ViewCount = p.ViewCount,
            DetailFields = p.FieldValues?.Where(v => v.FieldDefinition != null && v.FieldDefinition.DisplayOnDetails).OrderBy(v => v.FieldDefinition?.SortOrder ?? 0).Select(v => v.ToDto()).ToList() ?? new(),
            Benefits = p.Benefits?.OrderBy(b => b.SortOrder).Select(b => b.ToDto()).ToList() ?? new(),
            EligibilityCriteria = p.EligibilityCriteria?.OrderBy(e => e.SortOrder).Select(e => e.ToDto()).ToList() ?? new(),
            RecentReviews = p.Reviews?.Where(r => r.Status == "Published").OrderByDescending(r => r.CreatedAt).Take(5).Select(r => r.ToDto()).ToList() ?? new(),
            Promotions = p.Promotions?.Where(x => x.Status == "Active" || x.Status == "Scheduled").OrderByDescending(x => x.Priority).Select(x => x.ToDto()).ToList() ?? new()
        };
    }

    public static ApplicationListItemDto ToListItemDto(this DomainApplication a) => new()
    {
        Id = a.Id,
        ApplicationNumber = a.ApplicationNumber,
        CustomerName = a.CustomerName,
        ProductId = a.ProductId,
        ProductName = a.Product?.Name ?? string.Empty,
        CategoryName = a.Product?.Category?.Name ?? string.Empty,
        Status = a.Status.ToString(),
        CreatedAt = a.CreatedAt,
        SubmittedAt = a.SubmittedAt,
        UpdatedAt = a.UpdatedAt
    };

    public static ApplicationDocumentDto ToDto(this ApplicationDocument d) => new()
    {
        Id = d.Id,
        DocumentName = d.DocumentName,
        DocumentType = d.DocumentType,
        Required = d.Required,
        Uploaded = d.Uploaded,
        FileName = d.FileName,
        UploadedAt = d.UploadedAt,
        ContentType = d.ContentType,
        FileSizeBytes = d.FileSizeBytes
    };

    public static ApplicationDetailDto ToDetailDto(this DomainApplication a)
    {
        var list = a.ToListItemDto();
        return new ApplicationDetailDto
        {
            Id = list.Id,
            ApplicationNumber = list.ApplicationNumber,
            CustomerName = list.CustomerName,
            ProductId = list.ProductId,
            ProductName = list.ProductName,
            CategoryName = list.CategoryName,
            Status = list.Status,
            CreatedAt = list.CreatedAt,
            SubmittedAt = list.SubmittedAt,
            UpdatedAt = list.UpdatedAt,
            CustomerEmail = a.CustomerEmail,
            CustomerPhone = a.CustomerPhone,
            CustomerDateOfBirth = a.CustomerDateOfBirth,
            ReviewNotes = a.ReviewNotes,
            ProductIconKey = a.Product?.IconKey ?? string.Empty,
            FieldValues = a.FieldValues?.Select(v => new ApplicationFieldValueDto { FieldKey = v.FieldKey, FieldLabel = v.FieldLabel, Value = v.Value }).ToList() ?? new(),
            Documents = a.Documents?.Select(d => d.ToDto()).ToList() ?? new(),
            StatusHistory = a.StatusHistory?.OrderBy(h => h.ChangedAt).Select(h => new ApplicationStatusHistoryDto { Status = h.Status.ToString(), Note = h.Note, ChangedAt = h.ChangedAt }).ToList() ?? new()
        };
    }
}
