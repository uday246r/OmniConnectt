using System.Text.Json;
using System.Text.RegularExpressions;
using AuthService.Application.DTOs;
using AuthService.Application.Exceptions;
using AuthService.Domain.Entities;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Validation;
using Microsoft.EntityFrameworkCore;

namespace AuthService.Application.Services;

/// <summary>CRUD for the admin-defined "Manage Formats" catalog — see ValidationPresetCatalog's doc comment.</summary>
public class ValidationPresetAppService(AuthDbContext db, AuditLogAppService auditLog)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public const string KindRegex = FieldPresets.CustomPresetKindRegex;
    public const string KindLengthRange = FieldPresets.CustomPresetKindLengthRange;
    public const string KindNumericRange = FieldPresets.CustomPresetKindNumericRange;
    public const string KindTextPattern = FieldPresets.CustomPresetKindTextPattern;

    private static readonly HashSet<string> ValidKinds = [KindRegex, KindLengthRange, KindNumericRange, KindTextPattern];

    /// <summary>Built-in preset ids a custom format may never reuse — picking the same key would make
    /// a field's rule ambiguous about which catalog it came from.</summary>
    private static readonly HashSet<string> ReservedBuiltinKeys =
    [
        FieldPresets.LettersOnly, FieldPresets.LettersAndSpaces, FieldPresets.Alphanumeric,
        FieldPresets.NoSpecialCharacters, FieldPresets.DigitsOnly, FieldPresets.AadharFormat,
        FieldPresets.PanFormat, FieldPresets.Pincode, FieldPresets.Url, FieldPresets.EmailSmart,
        FieldPresets.MobileIN, FieldPresets.MinLength, FieldPresets.MaxLength, FieldPresets.ExactLength,
        FieldPresets.Custom,
    ];

    public async Task<ValidationPresetCatalogDto> GetAsync(CancellationToken ct = default)
    {
        var row = await db.ValidationPresetCatalogs.AsNoTracking().OrderByDescending(c => c.UpdatedAt).FirstOrDefaultAsync(ct);
        if (row is null)
        {
            return new ValidationPresetCatalogDto([], 0, DateTimeOffset.UtcNow);
        }

        var presets = JsonSerializer.Deserialize<List<CustomPresetDto>>(row.PresetsJson, JsonOptions) ?? [];
        return new ValidationPresetCatalogDto(presets, row.Version, row.UpdatedAt);
    }

    public async Task<IReadOnlyList<CustomPresetDto>> GetPresetsAsync(CancellationToken ct = default)
        => (await GetAsync(ct)).Presets;

    private const string StaleMessage =
        "Someone else changed the formats while you were editing. Reload to see their changes, then make yours again.";

    public async Task<ValidationPresetCatalogDto> UpdateAsync(
        UpdateValidationPresetCatalogRequest request, Guid? actingUserId, CancellationToken ct = default)
    {
        ValidateShape(request.Presets);

        var row = await db.ValidationPresetCatalogs.OrderByDescending(c => c.UpdatedAt).FirstOrDefaultAsync(ct);

        // Two administrators editing at once: a save based on an older version is refused rather than
        // silently undoing the other person's work.
        if (request.ExpectedVersion is {} expectedVersion && expectedVersion != (row?.Version ?? 0))
        {
            throw new ConflictAppException(StaleMessage);
        }

        var now = DateTimeOffset.UtcNow;
        var presetsJson = JsonSerializer.Serialize(request.Presets, JsonOptions);

        if (row is null)
        {
            row = new ValidationPresetCatalog { Id = Guid.NewGuid(), PresetsJson = presetsJson, Version = 1, UpdatedAt = now, UpdatedBy = actingUserId };
            db.ValidationPresetCatalogs.Add(row);
        }
        else
        {
            row.PresetsJson = presetsJson;
            row.Version += 1;
            row.UpdatedAt = now;
            row.UpdatedBy = actingUserId;
        }

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            throw new ConflictAppException(StaleMessage);
        }

        /*
         * Worth auditing for a reason specific to this catalog: an unrecognised preset id FAILS OPEN
         * everywhere in the validation system, deliberately, so that renaming or deleting a preset
         * can never block every submission on a field that references it. The cost of that choice is
         * that deleting a preset silently stops the rule it encoded from being enforced — the field
         * keeps its reference, validation quietly passes, and nothing anywhere reports it.
         *
         * This row is the only trace such a change leaves, which is why it names the preset keys.
         */
        var actorName = actingUserId is null
            ? null
            : await db.Users.AsNoTracking().Where(u => u.Id == actingUserId).Select(u => u.Name).FirstOrDefaultAsync(ct);

        await auditLog.WriteHostAsync(
            actingUserId, actorName, "validation_preset_catalog.updated",
            AuditLogAppService.Modules.UserSchema, AuditLogAppService.Categories.Configuration,
            entityType: "ValidationPresetCatalog", entityId: row.Id.ToString(), entityLabel: "Validation formats",
            details: $"Saved the admin-defined validation formats (version {row.Version}) — {request.Presets.Count} preset(s): " +
                     $"{string.Join(", ", request.Presets.Select(p => $"{p.Key} ({p.Kind})"))}.",
            ct: ct);

        return new ValidationPresetCatalogDto(request.Presets, row.Version, row.UpdatedAt);
    }

    private static void ValidateShape(IReadOnlyList<CustomPresetDto> presets)
    {
        var keys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var preset in presets)
        {
            if (string.IsNullOrWhiteSpace(preset.Key) || string.IsNullOrWhiteSpace(preset.Label))
            {
                throw new ValidationAppException("Every format needs a label.");
            }

            if (!keys.Add(preset.Key))
            {
                throw new ValidationAppException($"Format key '{preset.Key}' is used more than once.");
            }

            if (ReservedBuiltinKeys.Contains(preset.Key))
            {
                throw new ValidationAppException($"'{preset.Key}' is a reserved built-in format name.");
            }

            if (!ValidKinds.Contains(preset.Kind))
            {
                throw new ValidationAppException($"'{preset.Label}' has an unknown format type '{preset.Kind}'.");
            }

            if (string.IsNullOrWhiteSpace(preset.Message))
            {
                throw new ValidationAppException($"'{preset.Label}' needs an error message.");
            }

            switch (preset.Kind)
            {
                case KindRegex:
                    if (string.IsNullOrWhiteSpace(preset.Pattern))
                    {
                        throw new ValidationAppException($"'{preset.Label}' needs a regular expression.");
                    }
                    try
                    {
                        _ = new Regex(preset.Pattern);
                    }
                    catch (ArgumentException)
                    {
                        throw new ValidationAppException($"'{preset.Label}' has an invalid regular expression: {preset.Pattern}");
                    }
                    break;

                case KindLengthRange:
                    if (preset.MinLength is null && preset.MaxLength is null)
                    {
                        throw new ValidationAppException($"'{preset.Label}' needs a minimum and/or maximum length.");
                    }
                    if (preset.MinLength is not null && preset.MaxLength is not null && preset.MinLength > preset.MaxLength)
                    {
                        throw new ValidationAppException($"'{preset.Label}': minimum length cannot exceed maximum length.");
                    }
                    break;

                case KindNumericRange:
                    if (preset.MinValue is null && preset.MaxValue is null)
                    {
                        throw new ValidationAppException($"'{preset.Label}' needs a minimum and/or maximum value.");
                    }
                    if (preset.MinValue is not null && preset.MaxValue is not null && preset.MinValue > preset.MaxValue)
                    {
                        throw new ValidationAppException($"'{preset.Label}': minimum value cannot exceed maximum value.");
                    }
                    break;

                case KindTextPattern:
                    if (string.IsNullOrWhiteSpace(preset.TextMode) || !FieldPresets.TextPatternModes.Contains(preset.TextMode))
                    {
                        throw new ValidationAppException($"'{preset.Label}' needs a valid character type selected.");
                    }
                    break;
            }
        }
    }
}
