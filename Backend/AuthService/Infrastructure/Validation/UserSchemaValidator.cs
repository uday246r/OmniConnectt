using AuthService.Application.DTOs;

namespace AuthService.Infrastructure.Validation;

/// <summary>
/// Re-validates a create/update-user submission against the CURRENT admin-defined UserFieldSchema —
/// the server-side mirror of the frontend's validateFields, so a request that skips the browser
/// entirely (a direct API call) is held to exactly the same rules a real form submission would be.
///
/// The rules themselves are evaluated by the shared <see cref="FieldRuleEngine"/>, the same engine
/// LeadService uses; this class only adapts the user schema's DTOs to it and decides required-ness.
///
/// Deliberately never sees Role or Status — those are not part of UserFieldSchema at all (see the
/// entity's doc comment) and keep going through their own, unrelated validation in UserAppService.
///
/// For a `Core` field (name/email/phoneNumber), this only ever ADDS constraints on top of the fixed
/// required/max-length floor CreateUserRequest/UpdateUserRequest's data annotations already enforce —
/// an admin can make Name reject digits, but can never make it optional or lift the 200-character cap.
/// A non-core field's Required/format is entirely whatever the admin configured.
/// </summary>
public class UserSchemaValidator
{
    /// <param name="fields">The current schema's field definitions.</param>
    /// <param name="values">fieldKey -> submitted value (core fields included, e.g. "name"/"email"/"phoneNumber").</param>
    /// <param name="customPresets">The current admin-defined "Manage Formats" catalog.</param>
    public IReadOnlyList<FieldValidationErrorDto> Validate(
        IEnumerable<FieldDefinitionDto> fields, IReadOnlyDictionary<string, string?> values,
        IReadOnlyList<CustomPresetDto>? customPresets = null)
    {
        var errors = new List<FieldValidationErrorDto>();
        var presets = FieldRuleEngine.Index((customPresets ?? []).Select(ToFormatPreset));

        foreach (var field in fields)
        {
            values.TryGetValue(field.Key, out var raw);
            var value = raw?.Trim();

            // Required-ness for core fields is enforced by the DTO's data annotations already and is
            // never weakened here; for a custom field, Required is whatever the admin set.
            if (!field.Core && field.Required && string.IsNullOrEmpty(value))
            {
                errors.Add(new FieldValidationErrorDto(field.Key, $"{field.Label} is required."));
                continue;
            }

            var message = FieldRuleEngine.FirstFailure(field.Validations.Select(ToFieldRule), value, presets);
            if (message is not null)
            {
                errors.Add(new FieldValidationErrorDto(field.Key, message));
            }
        }

        return errors;
    }

    public static FieldRule ToFieldRule(ValidationRuleDto rule) => new(rule.Type, rule.Pattern, rule.Value, rule.Message);

    public static FormatPreset ToFormatPreset(CustomPresetDto preset) => new(
        preset.Key, preset.Label, preset.Kind, preset.Pattern, preset.MinLength, preset.MaxLength,
        preset.MinValue, preset.MaxValue, preset.Message, preset.TextMode);
}
