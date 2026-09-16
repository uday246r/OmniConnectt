using System.Text.RegularExpressions;

namespace OmniRemit.Validation;

/// <summary>
/// The "Email address" preset: a sane email shape plus a near-miss check on common domains, so
/// "name@gmail.comsssss" is refused. Mirrors Frontend/packages/ui/src/validation/emailSmart.ts.
/// </summary>
public static class EmailSmartValidator
{
    private static readonly Regex EmailShape = new(@"^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[A-Za-z]{2,24}$", RegexOptions.Compiled);

    private static readonly string[] CommonDomains =
    [
        "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "outlook.com",
        "hotmail.com", "live.com", "icloud.com", "rediffmail.com", "protonmail.com",
    ];

    /// <returns>true if the value is a valid-looking email (and not a near-miss of a common domain).</returns>
    public static bool IsValid(string value)
    {
        var trimmed = value.Trim();
        if (!EmailShape.IsMatch(trimmed))
        {
            return false;
        }

        var domain = trimmed[(trimmed.LastIndexOf('@') + 1)..].ToLowerInvariant();

        if (CommonDomains.Contains(domain))
        {
            return true;
        }

        return !CommonDomains.Any(d => domain.StartsWith(d, StringComparison.Ordinal) && domain.Length > d.Length);
    }
}
