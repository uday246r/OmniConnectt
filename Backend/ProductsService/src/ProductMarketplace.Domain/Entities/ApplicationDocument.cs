namespace ProductMarketplace.Domain.Entities;

public class ApplicationDocument
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ApplicationId { get; set; }
    public Application Application { get; set; } = null!;

    public string DocumentName { get; set; } = string.Empty;
    public string DocumentType { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public bool Required { get; set; }
    public bool Uploaded { get; set; }
    public DateTime? UploadedAt { get; set; }

    /// <summary>Server-side disk path of the stored file. Never serialized to the client.</summary>
    public string? StoragePath { get; set; }
    public string? ContentType { get; set; }
    public long? FileSizeBytes { get; set; }
}
