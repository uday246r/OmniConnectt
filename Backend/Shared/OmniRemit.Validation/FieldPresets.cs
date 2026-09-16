using System.Text.RegularExpressions;

namespace OmniRemit.Validation;

/// <summary>
/// The fixed preset catalog admins pick from when adding a validation rule to a field — mirrors
/// Frontend/packages/ui/src/validation/fieldPresets.ts. A preset id on one side with no match on the
/// other silently stops validating on whichever side was missed; the parity fixture catches that.
/// </summary>
public static class FieldPresets
{
    public const string LettersOnly = "lettersOnly";
    public const string LettersAndSpaces = "lettersAndSpaces";
    public const string Alphanumeric = "alphanumeric";
    public const string NoSpecialCharacters = "noSpecialCharacters";
    public const string AadharFormat = "aadharFormat";
    public const string PanFormat = "panFormat";
    public const string Pincode = "pincode";
    public const string Url = "url";
    public const string EmailSmart = "emailSmart";
    public const string MobileIN = "mobileIN";
    public const string MinLength = "minLength";
    public const string MaxLength = "maxLength";
    public const string ExactLength = "exactLength";
    public const string DigitsOnly = "digitsOnly";
    public const string Custom = "custom";

    /// <summary>Kind discriminators for the admin-defined "Manage Formats" catalog.</summary>
    public const string CustomPresetKindRegex = "regex";
    public const string CustomPresetKindLengthRange = "lengthRange";
    public const string CustomPresetKindNumericRange = "numericRange";
    public const string CustomPresetKindTextPattern = "textPattern";

    /// <summary>Character-class choices offered under the "textPattern" custom-preset kind — the
    /// "string option" a non-technical admin picks instead of writing a regex. Each maps 1:1 to one of
    /// the built-in regex presets below.</summary>
    public static readonly IReadOnlyList<string> TextPatternModes =
        [LettersOnly, LettersAndSpaces, Alphanumeric, NoSpecialCharacters, DigitsOnly];

    /// <summary>Every preset id the engine knows by itself, without an admin-defined format.</summary>
    public static readonly IReadOnlyList<string> BuiltInIds =
    [
        LettersOnly, LettersAndSpaces, Alphanumeric, NoSpecialCharacters, DigitsOnly,
        EmailSmart, MobileIN, AadharFormat, PanFormat, Pincode, Url, MinLength, MaxLength, ExactLength,
    ];

    /*
     * [0-9], never \d. In .NET \d matches every Unicode decimal digit (Arabic-Indic, Devanagari, ...);
     * in the browser it matches only 0-9. With \d a value typed in another script passed on the server
     * and failed in the form — the two engines disagreeing about the same field.
     */
    private static readonly IReadOnlyDictionary<string, Regex> RegexPresets = new Dictionary<string, Regex>
    {
        [LettersOnly] = new("^[A-Za-z]+$", RegexOptions.Compiled),
        [LettersAndSpaces] = new("^[A-Za-z ]+$", RegexOptions.Compiled),
        [Alphanumeric] = new("^[A-Za-z0-9]+$", RegexOptions.Compiled),
        [NoSpecialCharacters] = new("^[A-Za-z0-9 ]+$", RegexOptions.Compiled),
        [DigitsOnly] = new("^[0-9]+$", RegexOptions.Compiled),
        // 12 digits, optionally space-grouped in fours — e.g. "1234 5678 9012" or "123456789012".
        [AadharFormat] = new("^[0-9]{4} ?[0-9]{4} ?[0-9]{4}$", RegexOptions.Compiled),
        [PanFormat] = new("^[A-Z]{5}[0-9]{4}[A-Z]$", RegexOptions.Compiled),
        [Pincode] = new("^[0-9]{6}$", RegexOptions.Compiled),
    };

    public static bool TryGetRegex(string presetId, out Regex regex) => RegexPresets.TryGetValue(presetId, out regex!);

    /// <summary>A web address people can open: absolute, http or https. "mailto:" and "ftp://" are not websites.</summary>
    public static bool IsAbsoluteUrl(string value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
        (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps) &&
        !string.IsNullOrEmpty(uri.Host);
}
