using System.Text.Json;
using AuthService.Application.DTOs;
using AuthService.Application.Exceptions;
using AuthService.Domain.Entities;
using AuthService.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace AuthService.Application.Services;

/// <summary>
/// CRUD for the single UserFieldSchema row that drives the "Manage User Fields" admin screen and the
/// Create/Edit User form. See UserFieldSchema's doc comment for what this schema does and does not
/// cover (never Role/Status).
/// </summary>
public class UserFieldSchemaAppService(AuthDbContext db, AuditLogAppService auditLog)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>The three fields that always exist as real User columns, with the field-key -> expected
    /// data type they must keep — enforced on every save so the schema can never be edited into a state
    /// that no longer matches what the User entity actually has.</summary>
    public static readonly IReadOnlyDictionary<string, string> ReservedCoreKeys = new Dictionary<string, string>
    {
        ["name"] = "text",
        ["email"] = "email",
        ["phoneNumber"] = "text",
    };

    public async Task<UserFieldSchemaDto> GetAsync(CancellationToken ct = default)
    {
        var row = await db.UserFieldSchemas.AsNoTracking().OrderByDescending(s => s.UpdatedAt).FirstOrDefaultAsync(ct);
        if (row is null)
        {
            // Defence in depth — AuthDbSeeder seeds this row at startup, but a fresh/unseeded database
            // must still return something sane rather than a 500 or a form with zero fields.
            return new UserFieldSchemaDto(DefaultFields(), 0, DateTimeOffset.UtcNow);
        }

        var fields = JsonSerializer.Deserialize<List<FieldDefinitionDto>>(row.SchemaJson, JsonOptions) ?? [];

        // Read-time upgrade: schemas saved while sections were free text carry labels ("Address") or
        // nothing at all. Resolving here means every consumer — the form, the detail page, the server
        // validator — sees real section keys without a data migration having to rewrite the row.
        var sections = await FieldSectionAppService.ReadSectionsAsync(db, ct);
        return new UserFieldSchemaDto(Arrange(fields, sections), row.Version, row.UpdatedAt);
    }

    /// <summary>Fields only — for UserAppService's server-side validation of a create/update-user
    /// submission, without the controller-facing wrapper (version/updatedAt).</summary>
    public async Task<IReadOnlyList<FieldDefinitionDto>> GetFieldsAsync(CancellationToken ct = default)
        => (await GetAsync(ct)).Fields;

    private const string StaleMessage =
        "Someone else changed the user fields while you were editing. Reload to see their changes, then make yours again.";

    public async Task<UserFieldSchemaDto> UpdateAsync(
        UpdateUserFieldSchemaRequest request, Guid? actingUserId, CancellationToken ct = default)
    {
        ValidateShape(request.Fields);

        // Strict on save, lenient on read: a field naming a section that does not exist is an editor
        // bug or a stale tab, and is refused here rather than being quietly re-homed to the system
        // section. A blank section is fine — it means "no opinion" and resolves to the system section.
        var sections = await FieldSectionAppService.ReadSectionsAsync(db, ct);
        foreach (var field in request.Fields)
        {
            if (!FieldSectionAppService.IsKnownSection(field.Section, sections))
            {
                throw new ValidationAppException(
                    $"Field '{field.Label}' is in a section that no longer exists. Reload to see the current sections.");
            }
        }

        var fields = Arrange(request.Fields, sections);

        var row = await db.UserFieldSchemas.OrderByDescending(s => s.UpdatedAt).FirstOrDefaultAsync(ct);

        // Two administrators editing at once: a save based on an older version is refused rather than
        // silently undoing the other person's work.
        if (request.ExpectedVersion is {} expectedVersion && expectedVersion != (row?.Version ?? 0))
        {
            throw new ConflictAppException(StaleMessage);
        }

        var now = DateTimeOffset.UtcNow;
        var schemaJson = JsonSerializer.Serialize(fields, JsonOptions);

        if (row is null)
        {
            row = new UserFieldSchema { Id = Guid.NewGuid(), SchemaJson = schemaJson, Version = 1, UpdatedAt = now, UpdatedBy = actingUserId };
            db.UserFieldSchemas.Add(row);
        }
        else
        {
            row.SchemaJson = schemaJson;
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
         * Unaudited until now, along with the other two admin-editable catalogs.
         *
         * This schema decides what the Create/Edit User form collects and how each value is validated
         * — including the rules applied to name, email and phone number, which are real User columns.
         * Loosening a validation rule here silently changes what every subsequent account is allowed
         * to contain, and removing a field stops its value being stored at all. That is configuration
         * with the reach of a code change, and it left no record of who made it or when.
         *
         * The row names the fields rather than embedding the whole schema: the JSON is large, it is
         * recoverable from the row itself, and a list of field keys plus counts is what makes a
         * reviewer scanning the trail notice that a field disappeared.
         */
        var actorName = await ResolveActorNameAsync(actingUserId, ct);
        var coreCount = request.Fields.Count(f => f.Core);
        await auditLog.WriteHostAsync(
            actingUserId, actorName, "user_field_schema.updated",
            AuditLogAppService.Modules.UserSchema, AuditLogAppService.Categories.Configuration,
            entityType: "UserFieldSchema", entityId: row.Id.ToString(), entityLabel: "User field schema",
            details: $"Saved the user field schema (version {row.Version}) — {request.Fields.Count} field(s): " +
                     $"{coreCount} core, {request.Fields.Count - coreCount} custom. " +
                     $"Fields: {string.Join(", ", request.Fields.Select(f => f.Key))}.",
            ct: ct);

        return new UserFieldSchemaDto(fields, row.Version, row.UpdatedAt);
    }

    /// <summary>
    /// Puts every field into a real section and lays them out: sections in catalog order, fields in
    /// their existing relative order within each, <c>Order</c> renumbered 1..n PER SECTION.
    /// <para>
    /// Order used to be one global sequence, so "move this field up" had no meaning once fields were
    /// grouped — the neighbour above it might be in a different section entirely. Per-section order is
    /// what makes a move within a section, and a move between sections, independent operations.
    /// </para>
    /// </summary>
    public static List<FieldDefinitionDto> Arrange(
        IReadOnlyList<FieldDefinitionDto> fields, IReadOnlyList<FieldSectionDto> sections)
    {
        var sectionRank = sections.Select((s, i) => (s.Key, Rank: i)).ToDictionary(p => p.Key, p => p.Rank, StringComparer.OrdinalIgnoreCase);

        var placed = fields
            .Select((f, i) => (Field: f with { Section = FieldSectionAppService.ResolveSectionKey(
                string.IsNullOrWhiteSpace(f.Section) ? LegacyDefaultSectionKey(f, sections) : f.Section, sections) }, Index: i))
            .OrderBy(p => sectionRank.GetValueOrDefault(p.Field.Section!, int.MaxValue))
            .ThenBy(p => p.Field.Order)
            .ThenBy(p => p.Index)
            .Select(p => p.Field)
            .ToList();

        var counters = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < placed.Count; i++)
        {
            var key = placed[i].Section!;
            counters[key] = counters.GetValueOrDefault(key) + 1;
            placed[i] = placed[i] with { Order = counters[key] };
        }

        return placed;
    }

    private static readonly HashSet<string> LegacyAddressTemplates = new(StringComparer.OrdinalIgnoreCase)
    {
        "contact-country", "contact-state", "contact-city", "contact-postal-code", "contact-street-address",
    };

    private static readonly HashSet<string> LegacyAddressKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "country", "stateProvince", "city", "postalCode", "address",
    };

    /// <summary>
    /// The section an address-shaped field used to land in when it had none stored. Applied only to a
    /// BLANK section (an explicit choice always wins) and only while an <c>address</c> section still
    /// exists, so deleting it does not pull fields back into a section the admin removed. Exact matches
    /// only — the old substring guesses treated "estate" as "state". Kept in step with
    /// <c>legacyDefaultSectionKey</c> in the host's utils/sections.ts.
    /// </summary>
    public static string? LegacyDefaultSectionKey(FieldDefinitionDto field, IReadOnlyList<FieldSectionDto> sections)
    {
        var address = sections.FirstOrDefault(s => string.Equals(s.Key, "address", StringComparison.OrdinalIgnoreCase));
        if (address is null) return null;

        var isAddressShaped =
            (field.Template is not null && LegacyAddressTemplates.Contains(field.Template)) ||
            LegacyAddressKeys.Contains(field.Key);
        return isAddressShaped ? address.Key : null;
    }

    private async Task<string?> ResolveActorNameAsync(Guid? actingUserId, CancellationToken ct) =>
        actingUserId is null
            ? null
            : await db.Users.AsNoTracking().Where(u => u.Id == actingUserId).Select(u => u.Name).FirstOrDefaultAsync(ct);

    /// <summary>Guards that keep the schema internally consistent — a non-technical admin's mistakes
    /// (duplicate keys, an invalid custom regex) come back as a clear 400 rather than corrupting the
    /// next Create User form render.</summary>
    private static void ValidateShape(IReadOnlyList<FieldDefinitionDto> fields)
    {
        if (fields.Count == 0)
        {
            throw new ValidationAppException("At least one field is required.");
        }

        var keys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var field in fields)
        {
            if (string.IsNullOrWhiteSpace(field.Key))
            {
                throw new ValidationAppException($"Field '{field.Label}' is missing its internal key.");
            }

            if (!keys.Add(field.Key))
            {
                throw new ValidationAppException($"Field key '{field.Key}' is used more than once.");
            }

            var isReservedKey = ReservedCoreKeys.ContainsKey(field.Key);

            // A non-core field may never claim a reserved key, and a field claiming Core:true must be
            // exactly one of the three real columns — otherwise the schema could describe a "core"
            // field the User entity has no column for.
            if (field.Core && !isReservedKey)
            {
                throw new ValidationAppException($"'{field.Key}' cannot be marked as a core field.");
            }

            if (!field.Core && isReservedKey)
            {
                throw new ValidationAppException($"'{field.Key}' is a reserved core field name.");
            }

            if (string.Equals(field.DataType, "dropdown", StringComparison.OrdinalIgnoreCase))
            {
                if (field.Core)
                {
                    throw new ValidationAppException($"Core field '{field.Label}' cannot be a dropdown.");
                }

                if (!IsDynamicDropdown(field) && (field.Options is null || field.Options.Count == 0 || field.Options.All(string.IsNullOrWhiteSpace)))
                {
                    throw new ValidationAppException($"Dropdown field '{field.Label}' must have at least one option.");
                }
            }

            foreach (var rule in field.Validations)
            {
                if (rule.Type == FieldPresets.Custom)
                {
                    if (string.IsNullOrWhiteSpace(rule.Pattern))
                    {
                        throw new ValidationAppException($"'{field.Label}' has a custom rule with no pattern.");
                    }

                    try
                    {
                        _ = new System.Text.RegularExpressions.Regex(rule.Pattern);
                    }
                    catch (ArgumentException)
                    {
                        throw new ValidationAppException($"'{field.Label}' has an invalid custom pattern: {rule.Pattern}");
                    }
                }
            }
        }

        // Every reserved core key must be present — the create/edit-user form must always be able to
        // collect Name/Email/Mobile, since those back real, non-nullable-in-practice User columns.
        foreach (var (key, _) in ReservedCoreKeys)
        {
            if (!keys.Contains(key))
            {
                throw new ValidationAppException($"The '{key}' field cannot be removed.");
            }
        }
    }

    /// <summary>Seed shape — also used as GetAsync's fallback if the DB row is ever missing.</summary>
    public static List<FieldDefinitionDto> DefaultFields() =>
    [
        new("name", "Full Name", true, "text", true, 1, [], null, null, FieldSectionAppService.SystemSectionKey),
        new("email", "Email Address", true, "email", true, 2, [], null, null, FieldSectionAppService.SystemSectionKey),
        new("phoneNumber", "Mobile Number", true, "text", true, 3, [], null, null, FieldSectionAppService.SystemSectionKey),
    ];

    public static bool IsDynamicDropdown(FieldDefinitionDto field)
    {
        if (field.Template is "contact-state" or "contact-city" or "contact-phone")
            return true;

        if (string.Equals(field.Key, "state", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(field.Key, "stateProvince", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(field.Key, "city", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(field.Key, "phoneNumber", StringComparison.OrdinalIgnoreCase))
            return true;

        var label = (field.Label ?? string.Empty).Trim().ToLowerInvariant();
        if (label.Contains("state") || label.Contains("province") || label.Contains("city") || label.Contains("phone"))
            return true;

        return false;
    }
}
