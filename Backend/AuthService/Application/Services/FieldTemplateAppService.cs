using System.Text.Json;
using AuthService.Application.DTOs;
using AuthService.Application.Exceptions;
using AuthService.Domain.Entities;
using AuthService.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace AuthService.Application.Services;

/// <summary>
/// CRUD and validation for the database-backed FieldTemplateCatalog row.
/// Powers the dynamic template selector in user forms, field editor modal, and the Dropdown Templates management UI.
/// </summary>
public class FieldTemplateAppService(AuthDbContext db, AuditLogAppService auditLog)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<FieldTemplateCatalogDto> GetAsync(CancellationToken ct = default)
    {
        var row = await db.FieldTemplateCatalogs.AsNoTracking().OrderByDescending(c => c.UpdatedAt).FirstOrDefaultAsync(ct);
        if (row is null)
        {
            return new FieldTemplateCatalogDto(DefaultTemplates(), 0, DateTimeOffset.UtcNow);
        }

        var templates = JsonSerializer.Deserialize<List<FieldTemplateDto>>(row.TemplatesJson, JsonOptions) ?? [];
        return new FieldTemplateCatalogDto(templates, row.Version, row.UpdatedAt);
    }

    public async Task<IReadOnlyList<FieldTemplateDto>> GetTemplatesAsync(CancellationToken ct = default)
        => (await GetAsync(ct)).Templates;

    private const string StaleMessage =
        "Someone else changed the field templates while you were editing. Reload to see their changes, then make yours again.";

    public async Task<FieldTemplateCatalogDto> UpdateAsync(
        UpdateFieldTemplateCatalogRequest request, Guid? actingUserId, CancellationToken ct = default)
    {
        var normalized = Normalize(request.Templates);
        ValidateShape(normalized);

        var row = await db.FieldTemplateCatalogs.OrderByDescending(c => c.UpdatedAt).FirstOrDefaultAsync(ct);

        if (request.ExpectedVersion is { } expectedVersion && expectedVersion != (row?.Version ?? 0))
        {
            throw new ConflictAppException(StaleMessage);
        }

        var now = DateTimeOffset.UtcNow;
        var templatesJson = JsonSerializer.Serialize(normalized, JsonOptions);

        if (row is null)
        {
            row = new FieldTemplateCatalog
            {
                Id = Guid.NewGuid(),
                TemplatesJson = templatesJson,
                Version = 1,
                UpdatedAt = now,
                UpdatedBy = actingUserId,
            };
            db.FieldTemplateCatalogs.Add(row);
        }
        else
        {
            row.TemplatesJson = templatesJson;
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

        var actorName = await ResolveActorNameAsync(actingUserId, ct);
        await auditLog.WriteHostAsync(
            actingUserId, actorName, "field_templates.updated",
            AuditLogAppService.Modules.UserSchema, AuditLogAppService.Categories.Configuration,
            entityType: "FieldTemplateCatalog", entityId: row.Id.ToString(), entityLabel: "Field template catalog",
            details: $"Saved field templates (version {row.Version}) — {normalized.Count} template(s): " +
                     $"{string.Join(", ", normalized.Select(t => t.Name))}.",
            ct: ct);

        return new FieldTemplateCatalogDto(normalized, row.Version, row.UpdatedAt);
    }

    private static IReadOnlyList<FieldTemplateDto> Normalize(IReadOnlyList<FieldTemplateDto>? templates)
    {
        if (templates is null) return [];
        return templates.Select(t =>
        {
            IReadOnlyList<string>? cleanedOptions = null;
            if (string.Equals(t.DataType, "dropdown", StringComparison.OrdinalIgnoreCase) && t.Options is not null)
            {
                var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                var list = new List<string>();
                foreach (var opt in t.Options)
                {
                    var trimmed = opt?.Trim();
                    if (!string.IsNullOrEmpty(trimmed) && seen.Add(trimmed))
                    {
                        list.Add(trimmed);
                    }
                }
                cleanedOptions = list;
            }

            return t with
            {
                Name = t.Name?.Trim() ?? string.Empty,
                Label = t.Label?.Trim() ?? string.Empty,
                Category = t.Category?.Trim() ?? "custom",
                Description = string.IsNullOrWhiteSpace(t.Description) ? null : t.Description.Trim(),
                Options = cleanedOptions
            };
        }).ToList();
    }

    private async Task<string?> ResolveActorNameAsync(Guid? actingUserId, CancellationToken ct) =>
        actingUserId is null
            ? null
            : await db.Users.AsNoTracking().Where(u => u.Id == actingUserId).Select(u => u.Name).FirstOrDefaultAsync(ct);

    public static readonly HashSet<string> DynamicTemplateIds = new(StringComparer.OrdinalIgnoreCase)
    {
        "contact-state",
        "contact-city",
        "contact-phone"
    };

    private static void ValidateShape(IReadOnlyList<FieldTemplateDto> templates)
    {
        if (templates.Count == 0)
        {
            throw new ValidationAppException("At least one template is required in the catalog.");
        }

        var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var t in templates)
        {
            if (string.IsNullOrWhiteSpace(t.Id))
            {
                throw new ValidationAppException($"Template '{t.Name}' is missing an ID.");
            }

            if (string.IsNullOrWhiteSpace(t.Name))
            {
                throw new ValidationAppException($"Template '{t.Id}' must have a name.");
            }

            if (!ids.Add(t.Id))
            {
                throw new ValidationAppException($"Template ID '{t.Id}' is duplicated.");
            }

            if (string.Equals(t.DataType, "dropdown", StringComparison.OrdinalIgnoreCase))
            {
                var isDynamicDropdown = DynamicTemplateIds.Contains(t.Id) || t.Id.StartsWith("contact-state") || t.Id.StartsWith("contact-city");
                if (!isDynamicDropdown && (t.Options is null || t.Options.Count == 0 || t.Options.All(string.IsNullOrWhiteSpace)))
                {
                    throw new ValidationAppException($"Dropdown template '{t.Name}' must have at least one option.");
                }
            }
        }
    }

    public static List<FieldTemplateDto> DefaultTemplates() =>
    [
        new(
            "contact-country",
            "Country",
            "Country",
            "contact",
            "dropdown",
            "Searchable dropdown containing all countries of the world (via country-state-city)",
            AllCountries,
            IsSystem: true),
        new(
            "contact-state",
            "State / Province",
            "State / Province",
            "contact",
            "dropdown",
            "Cascading state/province dropdown dynamically filtered by selected country (via country-state-city)",
            null,
            IsSystem: true),
        new(
            "contact-city",
            "City",
            "City",
            "contact",
            "dropdown",
            "Cascading city dropdown dynamically filtered by selected state and country (via country-state-city)",
            null,
            IsSystem: true),
        new(
            "contact-postal-code",
            "Postal / ZIP Code",
            "Postal / ZIP Code",
            "contact",
            "text",
            "Input field for postal / zip code with country-aware validation (via postcode-validator)",
            null,
            IsSystem: true),
    ];

    public static readonly IReadOnlyList<string> CountryDialCodes =
    [
        "India (+91)", "United States (+1)", "United Kingdom (+44)", "Australia (+61)", "Canada (+1)",
        "Germany (+49)", "France (+33)", "Japan (+81)", "Singapore (+65)", "United Arab Emirates (+971)",
        "China (+86)", "Brazil (+55)", "South Africa (+27)", "Saudi Arabia (+966)", "New Zealand (+64)",
        "Italy (+39)", "Spain (+34)", "Netherlands (+31)", "Switzerland (+41)", "Sweden (+46)",
        "Mexico (+52)", "Malaysia (+60)", "Indonesia (+62)", "Philippines (+63)", "South Korea (+82)"
    ];

    public static readonly IReadOnlyList<string> AllCountries =
    [
        "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina", "Armenia",
        "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium",
        "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria",
        "Burkina Faso", "Burundi", "Cabo Verde", "Cambodia", "Cameroon", "Canada", "Central African Republic", "Chad",
        "Chile", "China", "Colombia", "Comoros", "Congo, Democratic Republic of the", "Congo, Republic of the",
        "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czech Republic", "Denmark", "Djibouti", "Dominica",
        "Dominican Republic", "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia",
        "Eswatini", "Ethiopia", "Fiji", "Finland", "France", "Gabon", "Gambia", "Georgia", "Germany", "Ghana",
        "Greece", "Grenada", "Guatemala", "Guinea", "Guinea-Bissau", "Guyana", "Haiti", "Honduras", "Hungary",
        "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy", "Ivory Coast", "Jamaica",
        "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati", "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon",
        "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg", "Madagascar", "Malawi",
        "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania", "Mauritius", "Mexico",
        "Micronesia", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique", "Myanmar",
        "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Korea",
        "North Macedonia", "Norway", "Oman", "Pakistan", "Palau", "Palestine", "Panama", "Papua New Guinea",
        "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia", "Rwanda",
        "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa", "San Marino",
        "Sao Tome and Principe", "Saudi Arabia", "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore",
        "Slovakia", "Slovenia", "Solomon Islands", "Somalia", "South Africa", "South Korea", "South Sudan",
        "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan",
        "Tanzania", "Thailand", "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey",
        "Turkmenistan", "Tuvalu", "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States",
        "Uruguay", "Uzbekistan", "Vanuatu", "Vatican City", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe"
    ];
}
