using System.Text;
using System.Text.Json;
using AuthService.Application.DTOs;
using AuthService.Application.Exceptions;
using AuthService.Domain.Entities;
using AuthService.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace AuthService.Application.Services;

/// <summary>
/// CRUD and validation for the database-backed FieldSectionCatalog row — the admin-managed list of
/// headings that group fields on the user form.
/// <para>
/// This service is also the one place that knows how a field's stored <c>Section</c> string maps to a
/// real section (<see cref="ResolveSectionKey"/>). That mapping is deliberately forgiving: sections used
/// to be free text, so existing schemas carry labels such as "Personal Details" rather than keys, and a
/// section deleted out from under a field must never make the form unrenderable.
/// </para>
/// </summary>
public class FieldSectionAppService(AuthDbContext db, AuditLogAppService auditLog)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// The undeletable section. It is where a field lands when its stored section is missing or no
    /// longer exists, so there is always somewhere to render it. Kept as a constant because the seeded
    /// default fields (name/email/phone) reference it.
    /// </summary>
    public const string SystemSectionKey = "personal-details";

    private const string StaleMessage =
        "Someone else changed the form sections while you were editing. Reload to see their changes, then make yours again.";

    public async Task<FieldSectionCatalogDto> GetAsync(CancellationToken ct = default)
    {
        var row = await db.FieldSectionCatalogs.AsNoTracking().OrderByDescending(c => c.UpdatedAt).FirstOrDefaultAsync(ct);
        if (row is null)
        {
            return new FieldSectionCatalogDto(DefaultSections(), 0, DateTimeOffset.UtcNow);
        }

        return new FieldSectionCatalogDto(Parse(row.SectionsJson), row.Version, row.UpdatedAt);
    }

    /// <summary>
    /// Sections only, read straight from the context. Static so <see cref="UserFieldSchemaAppService"/>
    /// can resolve field sections with the DbContext it already holds, instead of taking this whole
    /// service (and its audit dependency) as a constructor argument.
    /// </summary>
    public static async Task<IReadOnlyList<FieldSectionDto>> ReadSectionsAsync(AuthDbContext db, CancellationToken ct = default)
    {
        var row = await db.FieldSectionCatalogs.AsNoTracking().OrderByDescending(c => c.UpdatedAt).FirstOrDefaultAsync(ct);
        return row is null ? DefaultSections() : Parse(row.SectionsJson);
    }

    public async Task<FieldSectionCatalogDto> UpdateAsync(
        UpdateFieldSectionCatalogRequest request, Guid? actingUserId, CancellationToken ct = default)
    {
        var normalized = Normalize(request.Sections);
        ValidateShape(normalized);

        var row = await db.FieldSectionCatalogs.OrderByDescending(c => c.UpdatedAt).FirstOrDefaultAsync(ct);

        if (request.ExpectedVersion is { } expectedVersion && expectedVersion != (row?.Version ?? 0))
        {
            throw new ConflictAppException(StaleMessage);
        }

        var previous = row is null ? DefaultSections() : Parse(row.SectionsJson);
        var survivingKeys = new HashSet<string>(normalized.Select(s => s.Key), StringComparer.OrdinalIgnoreCase);
        var removedKeys = previous.Where(s => !survivingKeys.Contains(s.Key)).Select(s => s.Key).ToList();

        // A removed section that still holds fields must say where those fields go. Refused rather than
        // silently dumped into the system section: an admin deleting "Employment Details" should choose
        // the destination, not discover afterwards that a dozen fields moved somewhere unexpected.
        var movedFieldCount = 0;
        var schemaRow = await db.UserFieldSchemas.OrderByDescending(s => s.UpdatedAt).FirstOrDefaultAsync(ct);
        if (removedKeys.Count > 0 && schemaRow is not null)
        {
            var fields = JsonSerializer.Deserialize<List<FieldDefinitionDto>>(schemaRow.SchemaJson, JsonOptions) ?? [];
            var lookup = new Dictionary<string, string>(
                request.ReassignFieldsTo ?? new Dictionary<string, string>(), StringComparer.OrdinalIgnoreCase);

            var rewritten = new List<FieldDefinitionDto>(fields.Count);
            foreach (var field in fields)
            {
                var current = ResolveSectionKey(field.Section, previous);
                if (!removedKeys.Contains(current, StringComparer.OrdinalIgnoreCase))
                {
                    rewritten.Add(field);
                    continue;
                }

                if (!lookup.TryGetValue(current, out var target) || !survivingKeys.Contains(target))
                {
                    var label = previous.First(s => string.Equals(s.Key, current, StringComparison.OrdinalIgnoreCase)).Label;
                    throw new ValidationAppException(
                        $"Section '{label}' still has fields. Choose a section to move them to before deleting it.");
                }

                rewritten.Add(field with { Section = target });
                movedFieldCount++;
            }

            if (movedFieldCount > 0)
            {
                schemaRow.SchemaJson = JsonSerializer.Serialize(rewritten, JsonOptions);
                schemaRow.Version += 1;
                schemaRow.UpdatedAt = DateTimeOffset.UtcNow;
                schemaRow.UpdatedBy = actingUserId;
            }
        }

        var now = DateTimeOffset.UtcNow;
        var sectionsJson = JsonSerializer.Serialize(normalized, JsonOptions);

        if (row is null)
        {
            row = new FieldSectionCatalog
            {
                Id = Guid.NewGuid(),
                SectionsJson = sectionsJson,
                Version = 1,
                UpdatedAt = now,
                UpdatedBy = actingUserId,
            };
            db.FieldSectionCatalogs.Add(row);
        }
        else
        {
            row.SectionsJson = sectionsJson;
            row.Version += 1;
            row.UpdatedAt = now;
            row.UpdatedBy = actingUserId;
        }

        try
        {
            // One SaveChanges: the section list and any field moves it implies commit or fail together.
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            throw new ConflictAppException(StaleMessage);
        }

        var actorName = await ResolveActorNameAsync(actingUserId, ct);
        await auditLog.WriteHostAsync(
            actingUserId, actorName, "field_sections.updated",
            AuditLogAppService.Modules.UserSchema, AuditLogAppService.Categories.Configuration,
            entityType: "FieldSectionCatalog", entityId: row.Id.ToString(), entityLabel: "Field section catalog",
            details: $"Saved form sections (version {row.Version}) — {normalized.Count} section(s): " +
                     $"{string.Join(", ", normalized.Select(s => s.Label))}." +
                     (removedKeys.Count > 0 ? $" Removed: {string.Join(", ", removedKeys)}; {movedFieldCount} field(s) moved." : string.Empty),
            ct: ct);

        return new FieldSectionCatalogDto(normalized, row.Version, row.UpdatedAt);
    }

    /// <summary>
    /// Maps whatever a field stored in <c>Section</c> to a section key that exists in
    /// <paramref name="sections"/>. Never throws and never returns null: exact key match, else a
    /// case-insensitive LABEL match (this is what silently upgrades schemas written when sections were
    /// free text), else the system section.
    /// </summary>
    public static string ResolveSectionKey(string? stored, IReadOnlyList<FieldSectionDto> sections)
    {
        var value = stored?.Trim();
        if (!string.IsNullOrEmpty(value))
        {
            var byKey = sections.FirstOrDefault(s => string.Equals(s.Key, value, StringComparison.OrdinalIgnoreCase));
            if (byKey is not null) return byKey.Key;

            var byLabel = sections.FirstOrDefault(s => string.Equals(s.Label, value, StringComparison.OrdinalIgnoreCase));
            if (byLabel is not null) return byLabel.Key;
        }

        return sections.FirstOrDefault(s => s.IsSystem)?.Key ?? SystemSectionKey;
    }

    /// <summary>
    /// True when <paramref name="stored"/> is blank or names a real section by key or label. The strict
    /// save-time check; <see cref="ResolveSectionKey"/> is the lenient read-time one.
    /// </summary>
    public static bool IsKnownSection(string? stored, IReadOnlyList<FieldSectionDto> sections)
    {
        var value = stored?.Trim();
        if (string.IsNullOrEmpty(value)) return true; // blank = "no opinion", resolves to the system section
        return sections.Any(s =>
            string.Equals(s.Key, value, StringComparison.OrdinalIgnoreCase) ||
            string.Equals(s.Label, value, StringComparison.OrdinalIgnoreCase));
    }

    private static IReadOnlyList<FieldSectionDto> Normalize(IReadOnlyList<FieldSectionDto>? sections)
    {
        if (sections is null) return [];

        var usedKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var result = new List<FieldSectionDto>();

        // Stable sort by the client's Order, then renumber 1..n — the admin never types a number, the
        // list's position IS the order, so gaps and duplicates cannot exist after a save.
        foreach (var pair in sections.Select((s, i) => (s, i)).OrderBy(p => p.s.Order).ThenBy(p => p.i))
        {
            var section = pair.s;
            var label = section.Label?.Trim() ?? string.Empty;
            var key = section.Key?.Trim() ?? string.Empty;
            if (key.Length == 0) key = Slugify(label);

            // A newly created section can slug to something already taken; suffix rather than reject,
            // since the admin never sees or chooses the key.
            var candidate = key;
            for (var n = 2; !usedKeys.Add(candidate); n++)
            {
                candidate = $"{key}-{n}";
            }

            result.Add(new FieldSectionDto(candidate, label, result.Count + 1,
                string.Equals(candidate, SystemSectionKey, StringComparison.OrdinalIgnoreCase)));
        }

        return result;
    }

    private static void ValidateShape(IReadOnlyList<FieldSectionDto> sections)
    {
        if (sections.Count == 0)
        {
            throw new ValidationAppException("At least one section is required.");
        }

        var labels = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var section in sections)
        {
            if (string.IsNullOrWhiteSpace(section.Label))
            {
                throw new ValidationAppException("Every section needs a name.");
            }

            if (section.Label.Length > 100)
            {
                throw new ValidationAppException("Section names can be at most 100 characters.");
            }

            // Two sections sharing a visible name is exactly the confusion the free-text version allowed.
            if (!labels.Add(section.Label))
            {
                throw new ValidationAppException($"There is already a section named '{section.Label}'.");
            }
        }

        if (!sections.Any(s => string.Equals(s.Key, SystemSectionKey, StringComparison.OrdinalIgnoreCase)))
        {
            throw new ValidationAppException("The default section cannot be deleted. Rename it instead if it doesn't suit you.");
        }
    }

    public static string Slugify(string label)
    {
        var sb = new StringBuilder();
        foreach (var ch in label.Trim().ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(ch)) sb.Append(ch);
            else if (sb.Length > 0 && sb[^1] != '-') sb.Append('-');
        }

        var slug = sb.ToString().Trim('-');
        return slug.Length == 0 ? "section" : slug;
    }

    private static IReadOnlyList<FieldSectionDto> Parse(string json)
    {
        try
        {
            var sections = JsonSerializer.Deserialize<List<FieldSectionDto>>(json, JsonOptions);
            return sections is { Count: > 0 } ? sections.OrderBy(s => s.Order).ToList() : DefaultSections();
        }
        catch (JsonException)
        {
            // Same fail-soft doctrine as the preset catalog: a corrupt row must not make the user form
            // unrenderable. The defaults are always a valid, usable set.
            return DefaultSections();
        }
    }

    private async Task<string?> ResolveActorNameAsync(Guid? actingUserId, CancellationToken ct) =>
        actingUserId is null
            ? null
            : await db.Users.AsNoTracking().Where(u => u.Id == actingUserId).Select(u => u.Name).FirstOrDefaultAsync(ct);

    /// <summary>Seed shape — also GetAsync's fallback if the DB row is missing.</summary>
    public static List<FieldSectionDto> DefaultSections() =>
    [
        new(SystemSectionKey, "Personal Details", 1, true),
        new("address", "Address", 2),
        new("additional-details", "Additional Details", 3),
    ];
}
