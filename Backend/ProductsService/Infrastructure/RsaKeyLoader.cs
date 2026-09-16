using System;
using System.Security.Cryptography;

namespace ProductMarketplace.Api.Infrastructure;

public static class RsaKeyLoader
{
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
