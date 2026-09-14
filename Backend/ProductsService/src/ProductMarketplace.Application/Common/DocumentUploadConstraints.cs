namespace ProductMarketplace.Application.Common;

public static class DocumentUploadConstraints
{
    public const long MaxFileSizeBytes = 5 * 1024 * 1024; // 5 MB

    public static readonly Dictionary<string, string> AllowedContentTypesToExtension = new(StringComparer.OrdinalIgnoreCase)
    {
        ["application/pdf"] = ".pdf",
        ["image/jpeg"] = ".jpg",
        ["image/jpg"] = ".jpg",
        ["image/png"] = ".png"
    };

    public static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".pdf",
        ".jpg",
        ".jpeg",
        ".png"
    };
}
