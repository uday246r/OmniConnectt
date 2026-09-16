namespace AuthService.Application.DTOs;

/// <summary>
/// One admin-defined, reusable "format" — Settings > Manage Formats. `Kind` says which of the other
/// fields are meaningful:
///  - "regex": Pattern is used.
///  - "lengthRange": MinLength/MaxLength bound the value's character count (either may be null = open-ended).
///  - "numericRange": MinValue/MaxValue bound the value parsed as a number (either may be null = open-ended).
///  - "textPattern": TextMode picks a character-class constraint (letters only, digits only, ...) —
///    the "string" option for an admin who doesn't want to write a regex. See
///    OmniRemit.Validation.FieldPresets.TextPatternModes for the allowed values.
/// </summary>
public record CustomPresetDto(
    string Key,
    string Label,
    string Kind,
    string? Pattern,
    int? MinLength,
    int? MaxLength,
    decimal? MinValue,
    decimal? MaxValue,
    string Message,
    string? TextMode = null);

public record ValidationPresetCatalogDto(IReadOnlyList<CustomPresetDto> Presets, int Version, DateTimeOffset UpdatedAt);

/// <param name="ExpectedVersion">The version the editor loaded; a different current version is a 409, not a silent overwrite.</param>
public record UpdateValidationPresetCatalogRequest(IReadOnlyList<CustomPresetDto> Presets, int? ExpectedVersion = null);
