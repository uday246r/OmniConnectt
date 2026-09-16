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

    /// <summary>
    /// What a file really is, from its first bytes — never from the name or the Content-Type the browser
    /// sent, both of which the uploader chooses. Null when it is none of the accepted kinds.
    /// </summary>
    /// <remarks>
    /// The accepted types used to be checked only against the declared Content-Type and the extension, so
    /// renaming any file to <c>.pdf</c> and labelling it <c>application/pdf</c> stored it, and the download
    /// endpoint then served it back with that label. Identity documents are opened by staff; the file has
    /// to be what it says.
    /// </remarks>
    public static string? DetectContentType(ReadOnlySpan<byte> header)
    {
        if (header.Length >= 5 && header[..5].SequenceEqual("%PDF-"u8)) return "application/pdf";
        if (header.Length >= 3 && header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF) return "image/jpeg";
        if (header.Length >= 8 && header[..8].SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A })) return "image/png";
        return null;
    }

    public static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".pdf",
        ".jpg",
        ".jpeg",
        ".png"
    };
}
