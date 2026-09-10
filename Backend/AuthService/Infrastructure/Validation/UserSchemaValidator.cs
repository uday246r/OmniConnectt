using System.Text.RegularExpressions;
using AuthService.Application.DTOs;

namespace AuthService.Infrastructure.Validation;

/// <summary>
/// Re-validates a create/update-user submission against the CURRENT admin-defined UserFieldSchema —
/// the server-side mirror of the frontend's AJV-backed compileFieldValidator, so a request that skips
/// the browser entirely (a direct API call) is held to exactly the same rules a real form submission
/// would be.
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
    /// <param name="customPresets">The current admin-defined "Manage Formats" catalog — see
    /// ValidationPresetCatalog. Optional so callers that don't touch custom fields (none today) can omit it.</param>
    public IReadOnlyList<FieldValidationErrorDto> Validate(
        IEnumerable<FieldDefinitionDto> fields, IReadOnlyDictionary<string, string?> values,
        IReadOnlyList<CustomPresetDto>? customPresets = null)
    {
        var errors = new List<FieldValidationErrorDto>();
        var presetsByKey = (customPresets ?? []).ToDictionary(p => p.Key);

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

            if (string.IsNullOrEmpty(value))
            {
                continue; // optional and empty — no format rule applies to "nothing entered"
            }

            foreach (var rule in field.Validations)
            {
                var message = EvaluateRule(rule, value, presetsByKey);
                if (message is not null)
                {
                    // One problem per field at a time, mirroring the frontend's firstError() — a
                    // non-technical admin reading three stacked errors on one field is worse UX than
                    // fixing them one at a time.
                    errors.Add(new FieldValidationErrorDto(field.Key, message));
                    break;
                }
            }
        }

        return errors;
    }

    private static string? EvaluateRule(ValidationRuleDto rule, string value, IReadOnlyDictionary<string, CustomPresetDto> customPresets)
    {
        switch (rule.Type)
        {
            case FieldPresets.EmailSmart:
                return EmailSmartValidator.IsValid(value) ? null : rule.Message;

            case FieldPresets.MobileIN:
                return FieldPresets.MobileInDefaultShape.IsMatch(value) ? null : rule.Message;

            case FieldPresets.Url:
                return FieldPresets.IsAbsoluteUrl(value) ? null : rule.Message;

            case FieldPresets.MinLength:
                return value.Length >= (rule.Value ?? 0) ? null : rule.Message;

            case FieldPresets.MaxLength:
                return value.Length <= (rule.Value ?? int.MaxValue) ? null : rule.Message;

            case FieldPresets.ExactLength:
                return value.Length == rule.Value ? null : rule.Message;

            case FieldPresets.Custom:
                return IsCustomPatternMatch(rule.Pattern, value) ? null : rule.Message;

            default:
                if (customPresets.TryGetValue(rule.Type, out var preset))
                {
                    return EvaluateCustomPreset(preset, value) ? null : rule.Message;
                }

                // An unrecognised preset id (e.g. the catalog gained an entry only on the frontend, or
                // an admin later deleted a custom format still referenced by a field) fails OPEN rather
                // than blocking every submission on every field that uses it — a stale/missing preset
                // must never be able to lock every admin out of creating users.
                return FieldPresets.TryGetRegex(rule.Type, out var regex)
                    ? (regex.IsMatch(value) ? null : rule.Message)
                    : null;
        }
    }

    /// <summary>Applies one admin-defined "Manage Formats" preset — see ValidationPresetCatalog.</summary>
    private static bool EvaluateCustomPreset(CustomPresetDto preset, string value)
    {
        switch (preset.Kind)
        {
            case FieldPresets.CustomPresetKindRegex:
                return IsCustomPatternMatch(preset.Pattern, value);

            case FieldPresets.CustomPresetKindLengthRange:
                if (preset.MinLength is { } min && value.Length < min) return false;
                if (preset.MaxLength is { } max && value.Length > max) return false;
                return true;

            case FieldPresets.CustomPresetKindNumericRange:
                if (!decimal.TryParse(value, out var num)) return false;
                if (preset.MinValue is { } minVal && num < minVal) return false;
                if (preset.MaxValue is { } maxVal && num > maxVal) return false;
                return true;

            case FieldPresets.CustomPresetKindTextPattern:
                return preset.TextMode is not null
                       && FieldPresets.TryGetRegex(preset.TextMode, out var textRegex)
                       && textRegex.IsMatch(value);

            default:
                return true; // unknown kind — fail open, same reasoning as an unrecognised preset id
        }
    }

    private static bool IsCustomPatternMatch(string? pattern, string value)
    {
        if (string.IsNullOrWhiteSpace(pattern))
        {
            return true; // no pattern configured — nothing to enforce
        }

        try
        {
            // Same defensive posture as the frontend: an admin-supplied regex that fails to compile
            // must not crash validation for everyone submitting that field.
            return Regex.IsMatch(value, pattern, RegexOptions.None, TimeSpan.FromMilliseconds(200));
        }
        catch (Exception ex) when (ex is ArgumentException or RegexMatchTimeoutException)
        {
            return true; // fail open — an invalid/catastrophic admin-authored regex should never block every submission
        }
    }
}
