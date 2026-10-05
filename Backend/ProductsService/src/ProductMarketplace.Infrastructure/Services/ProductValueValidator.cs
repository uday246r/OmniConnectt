using System.Globalization;
using OmniConnect.Validation;
using ProductMarketplace.Application.Common;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Domain.Entities;
using ProductMarketplace.Domain.Enums;

namespace ProductMarketplace.Infrastructure.Services;

/// <summary>One accepted attribute value, ready to store.</summary>
internal sealed record AcceptedFieldValue(FieldDefinition Definition, string Value, decimal? Numeric);

/// <summary>
/// Holds a product's attribute values to its sub-category's field definitions.
/// </summary>
/// <remarks>
/// <para>
/// Before this, the service stored whatever it was sent: a field marked Required could be left empty, a
/// "rate" could be the word "high", a dropdown could hold a value that was never an option, and a value
/// for a field of some other sub-category was quietly dropped. The forms enforced most of it, and a
/// request that skipped the form enforced none of it.
/// </para>
/// <para>
/// Every failing field is reported, keyed by field key, in one <see cref="FieldValidationException"/>.
/// Format rules go through the shared field-rule engine, so the browser and this service hold a value to
/// the same rules; an unrecognised rule fails open there, exactly as it does everywhere else.
/// </para>
/// </remarks>
internal static class ProductValueValidator
{
    public static List<AcceptedFieldValue> Accept(
        ICollection<FieldDefinition> definitions,
        IReadOnlyCollection<ProductFieldValueInputDto> inputs,
        IReadOnlyList<FormatPreset> presets)
    {
        var errors = new Dictionary<string, string>();
        var known = definitions.ToDictionary(d => d.Id);
        var byField = new Dictionary<Guid, string>();

        foreach (var input in inputs)
        {
            if (!known.ContainsKey(input.FieldDefinitionId))
            {
                errors[input.FieldDefinitionId.ToString()] = "This field does not belong to the sub-category the product is in.";
            }
            else if (!byField.TryAdd(input.FieldDefinitionId, input.Value ?? string.Empty))
            {
                errors[known[input.FieldDefinitionId].Key] = $"\"{known[input.FieldDefinitionId].Label}\" was given more than once.";
            }
        }

        var index = FieldRuleEngine.Index(presets);
        var accepted = new List<AcceptedFieldValue>();

        foreach (var definition in definitions.OrderBy(d => d.SortOrder))
        {
            if (errors.ContainsKey(definition.Key)) continue;

            var value = byField.GetValueOrDefault(definition.Id)?.Trim() ?? string.Empty;
            if (value.Length == 0)
            {
                if (definition.Required) errors[definition.Key] = $"{definition.Label} is required.";
                continue;
            }

            var problem = CheckType(definition, value, out var numeric, out var canonical)
                          ?? FieldRuleEngine.FirstFailure(FieldRuleJson.Parse(definition.ValidationsJson).Select(r => r.ToEngineRule()), value, index);
            if (problem is not null)
            {
                errors[definition.Key] = problem;
                continue;
            }

            accepted.Add(new AcceptedFieldValue(definition, canonical ?? value, numeric));
        }

        if (errors.Count > 0) throw new FieldValidationException(errors);
        return accepted;
    }

    /// <summary>The problem with a value for its data type, or null. Also parses the number, and returns the option as spelled in the definition.</summary>
    private static string? CheckType(FieldDefinition definition, string value, out decimal? numeric, out string? canonical)
    {
        numeric = null;
        canonical = null;

        switch (definition.DataType)
        {
            case FieldDataType.Number:
            case FieldDataType.Currency:
            case FieldDataType.Percentage:
                if (!decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var number))
                    return $"{definition.Label} must be a number.";
                numeric = number;
                return null;

            case FieldDataType.Boolean:
                if (!bool.TryParse(value, out var flag)) return $"{definition.Label} must be true or false.";
                canonical = flag ? "true" : "false";
                return null;

            case FieldDataType.Date:
                return DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out _)
                    ? null
                    : $"{definition.Label} must be a date.";

            case FieldDataType.Dropdown:
            {
                var options = Options(definition);
                var match = options.FirstOrDefault(o => string.Equals(o, value, StringComparison.OrdinalIgnoreCase));
                if (match is null) return $"{definition.Label} must be one of: {string.Join(", ", options)}.";
                canonical = match;
                return null;
            }

            case FieldDataType.MultiSelect:
            {
                // Stored comma-separated; options may not contain a comma (see SubCategoryService).
                var options = Options(definition);
                var chosen = new List<string>();
                foreach (var part in value.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
                {
                    var match = options.FirstOrDefault(o => string.Equals(o, part, StringComparison.OrdinalIgnoreCase));
                    if (match is null) return $"\"{part}\" is not an option for {definition.Label}. Choose from: {string.Join(", ", options)}.";
                    if (!chosen.Contains(match)) chosen.Add(match);
                }

                canonical = string.Join(", ", chosen);
                return null;
            }

            default:
                return null;
        }
    }

    private static List<string> Options(FieldDefinition definition) =>
        string.IsNullOrEmpty(definition.OptionsJson)
            ? []
            : System.Text.Json.JsonSerializer.Deserialize<List<string>>(definition.OptionsJson) ?? [];
}
