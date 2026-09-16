using System.Globalization;
using System.Text.RegularExpressions;

namespace OmniRemit.Validation;

/// <summary>
/// One validation rule on a field: a built-in preset id ("emailSmart", "minLength" with a Value), an
/// admin-defined format key from Manage Formats, or "custom" with a one-off Pattern.
/// </summary>
public sealed record FieldRule(string Type, string? Pattern, int? Value, string Message);

/// <summary>
/// One admin-defined, reusable format from Settings → Manage Formats. <see cref="Kind"/> says which of
/// the other members apply — see <see cref="FieldPresets"/>' <c>CustomPresetKind*</c> constants.
/// </summary>
public sealed record FormatPreset(
    string Key,
    string Label,
    string Kind,
    string? Pattern,
    int? MinLength,
    int? MaxLength,
    decimal? MinValue,
    decimal? MaxValue,
    string Message,
    string? TextMode = null);

/// <summary>
/// Evaluates field rules — the one server-side implementation of what the browser's
/// <c>evaluateRule</c> / <c>validateFieldValue</c> do.
/// </summary>
/// <remarks>
/// <para>
/// Two principles, both shared with the browser and both load-bearing:
/// </para>
/// <list type="bullet">
/// <item><b>Fail open on anything unrecognised</b> — an unknown preset id, an unknown kind, a missing
/// text mode, a regex that does not compile or runs away. A format renamed or deleted in Manage Formats
/// must never make every submission on every field that used it impossible.</item>
/// <item><b>One problem at a time</b> — the first failing rule's message, so a person fixes one thing
/// and the two engines never disagree about which message to show.</item>
/// </list>
/// </remarks>
public static class FieldRuleEngine
{
    private static readonly TimeSpan RegexBudget = TimeSpan.FromMilliseconds(200);

    /// <summary>The first failing rule's message, or null when the value passes every rule. An empty
    /// value passes: whether a field may be empty is the caller's decision, not a format's.</summary>
    public static string? FirstFailure(
        IEnumerable<FieldRule> rules, string? value, IReadOnlyDictionary<string, FormatPreset>? presets = null)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed)) return null;

        presets ??= EmptyPresets;
        foreach (var rule in rules)
        {
            var message = Evaluate(rule, trimmed, presets);
            if (message is not null) return message;
        }

        return null;
    }

    public static IReadOnlyDictionary<string, FormatPreset> Index(IEnumerable<FormatPreset>? presets)
    {
        var index = new Dictionary<string, FormatPreset>(StringComparer.Ordinal);
        foreach (var preset in presets ?? [])
        {
            index.TryAdd(preset.Key, preset);
        }

        return index;
    }

    private static readonly IReadOnlyDictionary<string, FormatPreset> EmptyPresets = new Dictionary<string, FormatPreset>();

    /// <summary>One rule against a non-empty value. The rule's message on failure, null on success.</summary>
    public static string? Evaluate(FieldRule rule, string value, IReadOnlyDictionary<string, FormatPreset> presets)
    {
        switch (rule.Type)
        {
            case FieldPresets.EmailSmart:
                return EmailSmartValidator.IsValid(value) ? null : rule.Message;

            case FieldPresets.MobileIN:
                return PhoneNumbers.ValidateFull(value) is null ? null : rule.Message;

            case FieldPresets.Url:
                return FieldPresets.IsAbsoluteUrl(value) ? null : rule.Message;

            case FieldPresets.MinLength:
                return value.Length >= (rule.Value ?? 0) ? null : rule.Message;

            case FieldPresets.MaxLength:
                return value.Length <= (rule.Value ?? int.MaxValue) ? null : rule.Message;

            case FieldPresets.ExactLength:
                // No length configured is nothing to enforce, rather than "must be null characters long".
                return rule.Value is null || value.Length == rule.Value ? null : rule.Message;

            case FieldPresets.Custom:
                return MatchesPattern(rule.Pattern, value) ? null : rule.Message;

            default:
                if (presets.TryGetValue(rule.Type, out var preset))
                {
                    return EvaluatePreset(preset, value) ? null : rule.Message;
                }

                return FieldPresets.TryGetRegex(rule.Type, out var regex)
                    ? (regex.IsMatch(value) ? null : rule.Message)
                    : null;
        }
    }

    /// <summary>Applies one admin-defined format.</summary>
    public static bool EvaluatePreset(FormatPreset preset, string value)
    {
        switch (preset.Kind)
        {
            case FieldPresets.CustomPresetKindRegex:
                return MatchesPattern(preset.Pattern, value);

            case FieldPresets.CustomPresetKindLengthRange:
                if (preset.MinLength is { } min && value.Length < min) return false;
                if (preset.MaxLength is { } max && value.Length > max) return false;
                return true;

            case FieldPresets.CustomPresetKindNumericRange:
                if (!TryParseNumber(value, out var number)) return false;
                if (preset.MinValue is { } minValue && number < minValue) return false;
                if (preset.MaxValue is { } maxValue && number > maxValue) return false;
                return true;

            case FieldPresets.CustomPresetKindTextPattern:
                // No mode, or one this build does not know: nothing to enforce — fail open, as the browser does.
                return preset.TextMode is null
                       || !FieldPresets.TryGetRegex(preset.TextMode, out var textRegex)
                       || textRegex.IsMatch(value);

            default:
                return true;
        }
    }

    private static readonly Regex PlainNumber = new(@"^[+-]?[0-9]+(\.[0-9]+)?$", RegexOptions.Compiled);

    /// <summary>
    /// A plain decimal number, with optional thousands separators: "1500", "-2.5", "1,500.75".
    /// </summary>
    /// <remarks>
    /// Culture-invariant and deliberately narrow. It used to be <c>decimal.TryParse</c> in the server's
    /// culture — where "1,500" parsed on an en-US host and failed on a de-DE one — while the browser used
    /// <c>Number()</c>, which refuses "1,500" and accepts "1e3" and "0x10". Amounts people type are
    /// neither hexadecimal nor scientific; both sides now accept exactly this shape.
    /// </remarks>
    public static bool TryParseNumber(string value, out decimal number)
    {
        var compact = value.Trim().Replace(",", string.Empty, StringComparison.Ordinal);
        if (!PlainNumber.IsMatch(compact))
        {
            number = 0;
            return false;
        }

        return decimal.TryParse(compact, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out number);
    }

    private static bool MatchesPattern(string? pattern, string value)
    {
        if (string.IsNullOrWhiteSpace(pattern))
        {
            return true;
        }

        try
        {
            return Regex.IsMatch(value, pattern, RegexOptions.None, RegexBudget);
        }
        catch (Exception ex) when (ex is ArgumentException or RegexMatchTimeoutException)
        {
            // An admin-authored pattern that does not compile, or runs away, must not block every submission.
            return true;
        }
    }
}
