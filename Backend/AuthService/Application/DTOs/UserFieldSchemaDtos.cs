namespace AuthService.Application.DTOs;

/// <summary>
/// One validation rule attached to a field, e.g. { Type: "lettersAndSpaces", Message: "..." } or a
/// custom regex { Type: "custom", Pattern: "^EMP-[0-9]{4}$", Message: "..." }. `Type` is a key into the
/// preset catalog (UserSchemaValidator.FieldPresets on the backend, fieldPresets.ts on the frontend) —
/// "custom" is the one type that reads Pattern instead of looking itself up in the catalog. `Value` is
/// used by length-based presets (minLength/maxLength/exactLength).
/// </summary>
public record ValidationRuleDto(string Type, string? Pattern, int? Value, string Message);

/// <summary>
/// One field the Create/Edit User form collects. `Core` fields (name, email, phoneNumber) always exist
/// as real User columns and can never be removed or renamed via the schema builder — only their
/// Validations list is admin-editable, layered ON TOP OF the fixed required/max-length floor already
/// enforced by CreateUserRequest/UpdateUserRequest's data annotations (which never change). A non-core
/// field is fully admin-defined, including Required, and its value is stored in User.ExtraAttributes.
/// </summary>
public record FieldDefinitionDto(
    string Key,
    string Label,
    bool Core,
    string DataType,
    bool Required,
    int Order,
    IReadOnlyList<ValidationRuleDto> Validations,
    IReadOnlyList<string>? Options = null,
    string? Template = null,
    string? Section = null);

public record UserFieldSchemaDto(IReadOnlyList<FieldDefinitionDto> Fields, int Version, DateTimeOffset UpdatedAt);

/// <param name="ExpectedVersion">The version the editor loaded; a different current version is a 409, not a silent overwrite.</param>
public record UpdateUserFieldSchemaRequest(IReadOnlyList<FieldDefinitionDto> Fields, int? ExpectedVersion = null);

/// <summary>One field-level validation failure, e.g. from a dynamic (schema-defined) rule that a fixed
/// data-annotation on the DTO cannot express. Surfaced via FieldValidationException.</summary>
public record FieldValidationErrorDto(string FieldKey, string Message);
