using System.Text.RegularExpressions;

namespace AuthService.Application.Services;

public static class SecretRedactor
{
    private static readonly Regex[] RedactionPatterns =
    {
        // Passwords in general context (basic heuristic)
        new(@"(?i)(password|pwd|secret)\s*[:=]\s*[^\s,;\)]+", RegexOptions.Compiled),
        
        // API keys
        new(@"(?i)X-Internal-Api-Key\s*[:=]\s*[^\s]+", RegexOptions.Compiled),
        
        // Connection strings (specifically password parts)
        new(@"(?i)Password\s*=\s*[^;]+;?", RegexOptions.Compiled),
        
        // Bearer tokens (JWT, opaque tokens, truncated tokens)
        new(@"(?i)Bearer\s+[a-zA-Z0-9_\-\.]+", RegexOptions.Compiled),
        
        // PEM keys
        new(@"-----BEGIN[^-]+-----(?s).*?-----END[^-]+-----", RegexOptions.Compiled)
    };

    public static string? Redact(string? input)
    {
        if (string.IsNullOrWhiteSpace(input))
        {
            return input;
        }

        var result = input;
        foreach (var pattern in RedactionPatterns)
        {
            result = pattern.Replace(result, match =>
            {
                var value = match.Value;
                // Special handling to keep the key/prefix and just redact the value
                if (value.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
                    return "Bearer [REDACTED]";
                if (value.StartsWith("-----BEGIN", StringComparison.OrdinalIgnoreCase))
                    return "[REDACTED PEM KEY]";
                if (value.Contains("X-Internal-Api-Key", StringComparison.OrdinalIgnoreCase))
                    return "X-Internal-Api-Key: [REDACTED]";
                
                // For connection string passwords or general passwords
                var split = value.Split(new[] { ':', '=' }, 2);
                if (split.Length == 2)
                {
                    var sep = value.Contains(':') ? ":" : "=";
                    var end = value.EndsWith(";") ? ";" : "";
                    return $"{split[0]}{sep}[REDACTED]{end}";
                }
                
                return "[REDACTED]";
            });
        }

        return result;
    }
}
