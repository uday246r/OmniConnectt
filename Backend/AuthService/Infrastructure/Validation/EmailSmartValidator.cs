using System.Text.RegularExpressions;

namespace AuthService.Infrastructure.Validation;

/// <summary>
/// Port of the frontend's "emailSmart" preset (Frontend/apps/host/src/shared/validation/rules.ts,
/// `email()`) — same email shape plus the same near-miss-domain check (catches
/// "name@gmail.comsssssssss"), so a value the schema builder's "Email (smart)" preset accepts or
/// rejects on the frontend is judged identically here. Kept as a small hand-ported function rather
/// than shared code across languages — the two are meant to be kept in sync deliberately, not by
/// construction.
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

        var atIndex = trimmed.LastIndexOf('@');
        var domain = trimmed[(atIndex + 1)..].ToLowerInvariant();

        if (CommonDomains.Contains(domain))
        {
            return true;
        }

        var nearMiss = CommonDomains.Any(d => domain.StartsWith(d, StringComparison.Ordinal) && domain.Length > d.Length);
        return !nearMiss;
    }
}
