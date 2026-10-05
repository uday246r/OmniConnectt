using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using OmniConnect.Validation;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Infrastructure.Data;

namespace ProductMarketplace.Infrastructure.Services;

/// <summary>
/// Keeps a sibling set numbered 1..N with no gaps or duplicates. Used for categories, and for the
/// sub-categories inside one category.
/// </summary>
internal static class DisplayOrdering
{
    /// <summary>
    /// Puts <paramref name="item"/> at <paramref name="requestedOrder"/> (1-based, clamped) among
    /// <paramref name="others"/> — its siblings, already excluding it and already in order — and renumbers all.
    /// </summary>
    public static void Place<T>(List<T> others, T item, int requestedOrder, Action<T, int> setOrder)
    {
        others.Insert(Math.Clamp(requestedOrder - 1, 0, others.Count), item);
        Renumber(others, setOrder);
    }

    /// <summary>Numbers <paramref name="ordered"/> 1..N in the order given.</summary>
    public static void Renumber<T>(IReadOnlyList<T> ordered, Action<T, int> setOrder)
    {
        for (var i = 0; i < ordered.Count; i++) setOrder(ordered[i], i + 1);
    }
}

/// <summary>A field's rules, stored as JSON on <c>FieldDefinition.ValidationsJson</c>.</summary>
internal static class FieldRuleJson
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    /// <summary>A malformed stored value reads as "no rules" — a bad row must never stop products being saved.</summary>
    public static List<FieldRuleDto> Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            return (JsonSerializer.Deserialize<List<FieldRuleDto>>(json, Options) ?? [])
                .Where(r => !string.IsNullOrWhiteSpace(r.Type))
                .ToList();
        }
        catch (JsonException)
        {
            return [];
        }
    }

    public static string? Serialize(List<FieldRuleDto>? rules) =>
        rules is { Count: > 0 } ? JsonSerializer.Serialize(rules, Options) : null;

    public static FieldRule ToEngineRule(this FieldRuleDto rule) => new(rule.Type, rule.Pattern, rule.Value, rule.Message);

    /// <summary>
    /// Refuses a rule that could never work, at the moment an administrator saves it — not later, on the
    /// first product that happens to use the field. An <i>unrecognised</i> type is allowed on purpose: the
    /// engine fails open on those so a format renamed in Manage Formats never blocks every product.
    /// </summary>
    public static void EnsureUsable(IEnumerable<FieldRuleDto>? rules, string fieldLabel)
    {
        foreach (var rule in rules ?? [])
        {
            if (string.IsNullOrWhiteSpace(rule.Type))
                throw new InvalidOperationException($"A format rule on \"{fieldLabel}\" has no type.");
            if (string.IsNullOrWhiteSpace(rule.Message))
                throw new InvalidOperationException($"A format rule on \"{fieldLabel}\" needs a message to show when a value fails it.");

            if (rule.Type == FieldPresets.Custom)
            {
                if (string.IsNullOrWhiteSpace(rule.Pattern))
                    throw new InvalidOperationException($"The custom format rule on \"{fieldLabel}\" needs a pattern.");
                try
                {
                    _ = new Regex(rule.Pattern, RegexOptions.None, TimeSpan.FromMilliseconds(200));
                }
                catch (ArgumentException)
                {
                    throw new InvalidOperationException($"The pattern on the custom format rule for \"{fieldLabel}\" is not a valid regular expression.");
                }
            }

            var isLengthRule = rule.Type is FieldPresets.MinLength or FieldPresets.MaxLength or FieldPresets.ExactLength;
            if (isLengthRule && rule.Value is null or < 0)
                throw new InvalidOperationException($"The length rule on \"{fieldLabel}\" needs a length of zero or more.");
        }
    }
}

internal static class CatalogText
{
    private static readonly Regex NotKeyCharacters = new("[^a-z0-9]+", RegexOptions.Compiled);

    /// <summary>"Interest Rate (p.a.)" → "interest_rate_p_a", the stable key a field is stored and looked up by.</summary>
    public static string ToKey(string value) => NotKeyCharacters.Replace(value.Trim().ToLowerInvariant(), "_").Trim('_');
}

internal static class SaveExtensions
{
    private const string UniqueViolation = "23505";

    /// <summary>
    /// Saves, turning a unique-index violation into the same plain refusal a pre-check gives.
    /// </summary>
    /// <remarks>
    /// The services check for a duplicate before writing, but two requests can both pass that check; the
    /// unique index is what actually decides. Without this the loser of that race got a 500 and a trace id
    /// for what is an ordinary "that code is taken".
    /// </remarks>
    public static async Task SaveOrReportDuplicateAsync(this AppDbContext db, string duplicateMessage, CancellationToken ct = default)
    {
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: UniqueViolation })
        {
            throw new InvalidOperationException(duplicateMessage);
        }
    }
}
