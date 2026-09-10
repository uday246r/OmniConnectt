using System.Text.RegularExpressions;

namespace AuthService.Infrastructure.Validation;

/// <summary>
/// The preset catalog admins pick from when adding a validation rule to a field — mirrors
/// Frontend/packages/ui/src/validation/fieldPresets.ts. Keep the two in sync: a preset id added on one
/// side with no matching entry on the other silently stops validating on whichever side was missed.
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

    /// <summary>Kind discriminators for the admin-defined "Manage Formats" catalog — see
    /// ValidationPresetCatalog and ValidationPresetAppService.</summary>
    public const string CustomPresetKindRegex = "regex";
    public const string CustomPresetKindLengthRange = "lengthRange";
    public const string CustomPresetKindNumericRange = "numericRange";
    public const string CustomPresetKindTextPattern = "textPattern";

    /// <summary>Character-class choices offered under the "textPattern" custom-preset kind — the
    /// "string option" a non-technical admin picks instead of writing a regex. Each maps 1:1 to one of
    /// the built-in RegexPresets below.</summary>
    public static readonly IReadOnlyList<string> TextPatternModes =
        [LettersOnly, LettersAndSpaces, Alphanumeric, NoSpecialCharacters, DigitsOnly];

    /// <summary>Presets whose entire check is "does the value match this regex" — the common case.</summary>
    private static readonly IReadOnlyDictionary<string, Regex> RegexPresets = new Dictionary<string, Regex>
    {
        [LettersOnly] = new("^[A-Za-z]+$", RegexOptions.Compiled),
        [LettersAndSpaces] = new("^[A-Za-z ]+$", RegexOptions.Compiled),
        [Alphanumeric] = new("^[A-Za-z0-9]+$", RegexOptions.Compiled),
        [NoSpecialCharacters] = new(@"^[A-Za-z0-9 ]+$", RegexOptions.Compiled),
        [DigitsOnly] = new(@"^[0-9]+$", RegexOptions.Compiled),
        // 12 digits, optionally space-grouped in fours — e.g. "1234 5678 9012" or "123456789012".
        [AadharFormat] = new(@"^\d{4}\s?\d{4}\s?\d{4}$", RegexOptions.Compiled),
        [PanFormat] = new("^[A-Z]{5}[0-9]{4}[A-Z]$", RegexOptions.Compiled),
        [Pincode] = new(@"^\d{6}$", RegexOptions.Compiled),
    };

    public static bool TryGetRegex(string presetId, out Regex regex) => RegexPresets.TryGetValue(presetId, out regex!);

    /// <summary>Same shape check CreateUserRequest/UpdateUserRequest already enforce on PhoneNumber via
    /// data annotation — reused here rather than redefined, so "the default mobile rule" means one
    /// thing in the whole service.</summary>
    public static readonly Regex MobileInDefaultShape = new(@"^(?=(?:\D*\d){7,15}\D*$)[0-9+()\-.\s]+$", RegexOptions.Compiled);

    public static bool IsAbsoluteUrl(string value)
    {
        return Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
               (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
    }
}
