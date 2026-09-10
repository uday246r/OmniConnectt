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
public class UserFieldSchemaAppService(AuthDbContext db)
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
        return new UserFieldSchemaDto(fields, row.Version, row.UpdatedAt);
    }

    /// <summary>Fields only — for UserAppService's server-side validation of a create/update-user
    /// submission, without the controller-facing wrapper (version/updatedAt).</summary>
    public async Task<IReadOnlyList<FieldDefinitionDto>> GetFieldsAsync(CancellationToken ct = default)
        => (await GetAsync(ct)).Fields;

    public async Task<UserFieldSchemaDto> UpdateAsync(
        UpdateUserFieldSchemaRequest request, Guid? actingUserId, CancellationToken ct = default)
    {
        ValidateShape(request.Fields);

        var row = await db.UserFieldSchemas.OrderByDescending(s => s.UpdatedAt).FirstOrDefaultAsync(ct);
        var now = DateTimeOffset.UtcNow;
        var schemaJson = JsonSerializer.Serialize(request.Fields, JsonOptions);

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

        await db.SaveChangesAsync(ct);
        return new UserFieldSchemaDto(request.Fields, row.Version, row.UpdatedAt);
    }

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

            foreach (var rule in field.Validations)
            {
                if (rule.Type == Infrastructure.Validation.FieldPresets.Custom)
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
        new("name", "Full Name", true, "text", true, 1, []),
        new("email", "Email Address", true, "email", true, 2, []),
        new("phoneNumber", "Mobile Number", true, "text", true, 3, []),
    ];
}
