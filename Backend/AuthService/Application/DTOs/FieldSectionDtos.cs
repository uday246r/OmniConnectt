namespace AuthService.Application.DTOs;

/// <summary>
/// One form section. <c>Key</c> is the immutable identity a field points at; <c>Label</c> is what the
/// admin sees and can rename freely; <c>Order</c> is the section's position (1..n, renumbered by the
/// server on every save); <c>IsSystem</c> marks the one section that can be renamed and reordered but
/// never deleted, because it is where a field lands when its own section can't be resolved.
/// </summary>
public record FieldSectionDto(string Key, string Label, int Order, bool IsSystem = false);

public record FieldSectionCatalogDto(IReadOnlyList<FieldSectionDto> Sections, int Version, DateTimeOffset UpdatedAt);

/// <param name="ExpectedVersion">The version the editor loaded; a different current version is a 409, not a silent overwrite.</param>
/// <param name="ReassignFieldsTo">
/// For every section being removed that still holds fields: <c>removedKey -> surviving section key</c>.
/// Carried in the same request so a delete and the move of its fields commit together — two separate
/// saves could leave fields pointing at a section that no longer exists if the second one failed.
/// </param>
public record UpdateFieldSectionCatalogRequest(
    IReadOnlyList<FieldSectionDto> Sections,
    int? ExpectedVersion = null,
    IReadOnlyDictionary<string, string>? ReassignFieldsTo = null);
