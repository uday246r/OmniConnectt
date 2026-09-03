using System.Security.Cryptography;

namespace AuthService.Infrastructure.Security;

/// <summary>
/// Parses an RSA PEM key out of an env-var-safe encoding (literal "\n" instead of real newlines,
/// the common convention for putting multi-line PEM content in a single .env line).
/// </summary>
public static class RsaKeyLoader
{
    public static RSA LoadPrivateKey(string pem)
    {
        var rsa = RSA.Create();
        var normalized = Normalize(pem);
        try
        {
            rsa.ImportFromPem(normalized);
        }
        catch
        {
            var base64 = normalized.Replace("-----BEGIN PRIVATE KEY-----", "")
                                   .Replace("-----END PRIVATE KEY-----", "")
                                   .Replace("-----BEGIN RSA PRIVATE KEY-----", "")
                                   .Replace("-----END RSA PRIVATE KEY-----", "")
                                   .Replace("\n", "")
                                   .Replace("\r", "")
                                   .Replace(" ", "")
                                   .Trim();
            rsa.ImportPkcs8PrivateKey(Convert.FromBase64String(base64), out _);
        }
        return rsa;
    }

    public static RSA LoadPublicKey(string pem)
    {
        var rsa = RSA.Create();
        var normalized = Normalize(pem);
        try
        {
            rsa.ImportFromPem(normalized);
        }
        catch
        {
            var base64 = normalized.Replace("-----BEGIN PUBLIC KEY-----", "")
                                   .Replace("-----END PUBLIC KEY-----", "")
                                   .Replace("-----BEGIN RSA PUBLIC KEY-----", "")
                                   .Replace("-----END RSA PUBLIC KEY-----", "")
                                   .Replace("\n", "")
                                   .Replace("\r", "")
                                   .Replace(" ", "")
                                   .Trim();
            rsa.ImportSubjectPublicKeyInfo(Convert.FromBase64String(base64), out _);
        }
        return rsa;
    }

    private static string Normalize(string pem) => pem.Trim().Trim('"').Trim('\'').Replace("\\n", "\n").Replace("\r", "").Trim();
}
