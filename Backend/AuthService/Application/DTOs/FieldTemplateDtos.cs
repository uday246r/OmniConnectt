namespace AuthService.Application.DTOs;

/// <summary>
/// One field template with pre-configured properties and allowed options (for dropdowns).
/// </summary>
public record FieldTemplateDto(
    string Id,
    string Name,
    string Label,
    string Category,
    string DataType,
    string? Description = null,
    IReadOnlyList<string>? Options = null,
    bool IsSystem = false);

public record FieldTemplateCatalogDto(
    IReadOnlyList<FieldTemplateDto> Templates,
    int Version,
    DateTimeOffset UpdatedAt);

public record UpdateFieldTemplateCatalogRequest(
    IReadOnlyList<FieldTemplateDto> Templates,
    int? ExpectedVersion = null);
