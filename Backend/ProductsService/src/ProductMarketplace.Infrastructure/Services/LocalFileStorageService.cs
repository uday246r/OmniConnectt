using Microsoft.AspNetCore.Hosting;
using ProductMarketplace.Application.Interfaces;

namespace ProductMarketplace.Infrastructure.Services;

public class LocalFileStorageService : IFileStorageService
{
    private readonly string _uploadDirectory;

    /// <param name="configuration">
    /// <c>Storage:UploadsPath</c> points the store at a shared volume, which is what lets more than one
    /// instance serve the same documents. Unset, files go under the content root, which is right for one
    /// instance only — each replica would otherwise hold its own, partial set.
    /// </param>
    public LocalFileStorageService(IWebHostEnvironment env, Microsoft.Extensions.Configuration.IConfiguration configuration)
    {
        var configured = configuration["Storage:UploadsPath"];
        _uploadDirectory = string.IsNullOrWhiteSpace(configured)
            ? Path.Combine(env.ContentRootPath, "AppData", "Uploads")
            : Path.GetFullPath(configured);
        Directory.CreateDirectory(_uploadDirectory);
    }

    public async Task<string> SaveAsync(Guid applicationId, Guid documentId, string originalFileName, Stream content, CancellationToken ct = default)
    {
        var ext = Path.GetExtension(originalFileName);
        var safeFileName = $"{applicationId}_{documentId}_{Guid.NewGuid():N}{ext}";
        var fullPath = Path.Combine(_uploadDirectory, safeFileName);

        using var fileStream = new FileStream(fullPath, FileMode.Create, FileAccess.Write, FileShare.None);
        await content.CopyToAsync(fileStream, ct);

        return safeFileName;
    }

    public Task<Stream?> OpenReadAsync(string storagePath, CancellationToken ct = default)
    {
        var fullPath = Path.Combine(_uploadDirectory, Path.GetFileName(storagePath));
        if (!File.Exists(fullPath))
        {
            return Task.FromResult<Stream?>(null);
        }

        Stream stream = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.Read);
        return Task.FromResult<Stream?>(stream);
    }

    public void Delete(string storagePath)
    {
        var fullPath = Path.Combine(_uploadDirectory, Path.GetFileName(storagePath));
        if (File.Exists(fullPath))
        {
            try
            {
                File.Delete(fullPath);
            }
            catch
            {
                // Ignore transient delete issues
            }
        }
    }
}
