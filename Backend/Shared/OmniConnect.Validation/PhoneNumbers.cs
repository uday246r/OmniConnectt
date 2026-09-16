using System.Text.RegularExpressions;

namespace OmniConnect.Validation;

/// <summary>
/// Country-aware phone validation — the server half of Frontend/packages/ui/src/validation/phone.ts,
/// with the same country table.
/// </summary>
/// <remarks>
/// The "Mobile number" preset used to be a country-agnostic "7 to 15 digits" here while the form
/// checked the real digit count for the chosen country. A 9-digit Indian number passed an API call and
/// failed the form. Both now read one table, pinned together by the parity fixture.
/// </remarks>
public static class PhoneNumbers
{
    public sealed record Country(string Code, string Name, string DialCode, int MinDigits, int MaxDigits);

    public const string DefaultCountryCode = "IN";

    public static readonly IReadOnlyList<Country> Countries =
    [
        new("IN", "India", "+91", 10, 10),
        new("US", "United States", "+1", 10, 10),
        new("GB", "United Kingdom", "+44", 10, 11),
        new("AE", "United Arab Emirates", "+971", 9, 9),
        new("CA", "Canada", "+1", 10, 10),
        new("AU", "Australia", "+61", 9, 9),
        new("SG", "Singapore", "+65", 8, 8),
        new("DE", "Germany", "+49", 10, 11),
        new("FR", "France", "+33", 9, 9),
        new("SA", "Saudi Arabia", "+966", 9, 9),
        new("QA", "Qatar", "+974", 8, 8),
        new("PH", "Philippines", "+63", 10, 10),
        new("NP", "Nepal", "+977", 10, 10),
        new("BD", "Bangladesh", "+880", 10, 10),
        new("MY", "Malaysia", "+60", 9, 10),
        new("JP", "Japan", "+81", 10, 10),
        new("NG", "Nigeria", "+234", 10, 10),
        new("KE", "Kenya", "+254", 9, 9),
        new("ZA", "South Africa", "+27", 9, 9),
        new("BR", "Brazil", "+55", 10, 11),
        new("MX", "Mexico", "+52", 10, 10),
        new("CN", "China", "+86", 11, 11),
        new("HK", "Hong Kong", "+852", 8, 8),
        new("ID", "Indonesia", "+62", 9, 12),
        new("PK", "Pakistan", "+92", 10, 10),
        new("LK", "Sri Lanka", "+94", 9, 9),
        new("CH", "Switzerland", "+41", 9, 9),
        new("NL", "Netherlands", "+31", 9, 9),
        new("SE", "Sweden", "+46", 9, 9),
        new("IE", "Ireland", "+353", 9, 9),
        new("NZ", "New Zealand", "+64", 8, 10),
        new("ES", "Spain", "+34", 9, 9),
        new("IT", "Italy", "+39", 10, 10),
        new("PT", "Portugal", "+351", 9, 9),
        new("PL", "Poland", "+48", 9, 9),
    ];

    private static readonly Regex AllowedNationalCharacters = new(@"^[0-9 ()\-.]+$", RegexOptions.Compiled);

    private static readonly IReadOnlyList<Country> ByLongestDialCode =
        Countries.OrderByDescending(c => c.DialCode.Length).ToList();

    public static Country FindCountry(string? code) =>
        Countries.FirstOrDefault(c => c.Code == code) ?? Countries[0];

    /// <summary>Longest dial code first, so "+91" is never read as "+9". No recognised code means the
    /// default country, so an existing record stays editable.</summary>
    public static (Country Country, string National) Split(string? stored)
    {
        var trimmed = (stored ?? string.Empty).Trim();
        foreach (var country in ByLongestDialCode)
        {
            if (trimmed.StartsWith(country.DialCode, StringComparison.Ordinal))
            {
                return (country, trimmed[country.DialCode.Length..].Trim());
            }
        }

        return (FindCountry(DefaultCountryCode), trimmed);
    }

    /// <summary>A full number carrying its dial code, e.g. "+60 12-345 6789". Null when valid.</summary>
    public static string? ValidateFull(string? stored)
    {
        if (string.IsNullOrWhiteSpace(stored)) return "Phone number is required.";
        var (country, national) = Split(stored);
        return ValidateNational(national, country);
    }

    public static string? ValidateNational(string? national, Country country)
    {
        if (string.IsNullOrWhiteSpace(national)) return "Phone number is required.";

        var trimmed = national.Trim();
        if (!AllowedNationalCharacters.IsMatch(trimmed))
        {
            return "Phone number may contain only digits and formatting characters.";
        }

        var digits = trimmed.Count(char.IsAsciiDigit);
        if (digits == 0) return "Phone number is required.";

        if (country.MinDigits == country.MaxDigits)
        {
            return digits == country.MinDigits
                ? null
                : $"{country.Name} phone number requires exactly {country.MinDigits} digits ({digits} entered).";
        }

        return digits >= country.MinDigits && digits <= country.MaxDigits
            ? null
            : $"{country.Name} phone number must be between {country.MinDigits} and {country.MaxDigits} digits ({digits} entered).";
    }
}
