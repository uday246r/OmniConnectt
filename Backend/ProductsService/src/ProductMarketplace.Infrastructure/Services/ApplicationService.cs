using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Application.Common;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;
using ProductMarketplace.Domain.Entities;
using ProductMarketplace.Domain.Enums;
using ProductMarketplace.Infrastructure.Data;
using DomainApplication = ProductMarketplace.Domain.Entities.Application;

namespace ProductMarketplace.Infrastructure.Services;

public partial class ApplicationService : IApplicationService
{
    // The two lifecycle states this service reasons about directly. Every other status is
    // admin-configurable via StatusConfig and is never referenced by name in code.
    private const string DraftStatus = "Draft";
    private const string SubmittedStatus = "Submitted";
    private const int ApplicationNumberSeed = 1001;

    private readonly AppDbContext _db;
    private readonly IAuditLogService _audit;
    private readonly IFileStorageService _fileStorage;
    public ApplicationService(AppDbContext db, IAuditLogService audit, IFileStorageService fileStorage)
    {
        _db = db;
        _audit = audit;
        _fileStorage = fileStorage;
    }

    [GeneratedRegex(@"^[A-Za-z][A-Za-z .'-]{1,79}$")]
    private static partial Regex NameRegex();
    [GeneratedRegex(@"^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$")]
    private static partial Regex EmailRegex();
    [GeneratedRegex(@"^\+[1-9]\d{6,14}$")]
    private static partial Regex PhoneRegex();

    private IQueryable<DomainApplication> FullGraph() => _db.Applications
        .Include(a => a.Product).ThenInclude(p => p.Category)
        .Include(a => a.FieldValues)
        .Include(a => a.Documents)
        .Include(a => a.StatusHistory);

    public async Task<PagedResult<ApplicationListItemDto>> SearchAsync(ApplicationQueryDto query, CancellationToken ct = default)
    {
        var q = Filtered(query, includeStatus: true);

        var total = await q.CountAsync(ct);
        // A list row needs the product and its category only. This used to load every application's
        // field values, documents and status history (four split queries per page) just to discard them.
        var items = await q.Include(a => a.Product).ThenInclude(p => p.Category)
            .AsNoTracking()
            .OrderByDescending(a => a.CreatedAt).ThenBy(a => a.Id)
            .Skip((query.Page - 1) * query.PageSize).Take(query.PageSize)
            .ToListAsync(ct);

        return new PagedResult<ApplicationListItemDto> { Items = items.Select(a => a.ToListItemDto()).ToList(), Page = query.Page, PageSize = query.PageSize, TotalCount = total };
    }

    public async Task<IReadOnlyList<StatusCountDto>> StatusCountsAsync(ApplicationQueryDto query, CancellationToken ct = default)
    {
        var rows = await Filtered(query, includeStatus: false)
            .GroupBy(a => a.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync(ct);
        return rows.OrderBy(r => r.Status).Select(r => new StatusCountDto(r.Status, r.Count)).ToList();
    }

    private IQueryable<DomainApplication> Filtered(ApplicationQueryDto query, bool includeStatus)
    {
        IQueryable<DomainApplication> q = _db.Applications.AsNoTracking();
        if (query.ProductId.HasValue) q = q.Where(a => a.ProductId == query.ProductId);
        if (includeStatus && !string.IsNullOrWhiteSpace(query.Status))
            q = q.Where(a => a.Status == query.Status);
        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var lower = query.Search.Trim().ToLower();
            q = q.Where(a => a.CustomerName.ToLower().Contains(lower) || a.ApplicationNumber.ToLower().Contains(lower) || a.Product.Name.ToLower().Contains(lower));
        }
        return q;
    }

    public async Task<ApplicationDetailDto?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        var a = await FullGraph().FirstOrDefaultAsync(a => a.Id == id, ct);
        return a?.ToDetailDto();
    }

    public async Task<ApplicationDetailDto> CreateAsync(ApplicationCreateDto dto, CancellationToken ct = default)
    {
        var product = await _db.Products.Include(p => p.ProductType).ThenInclude(pt => pt.FieldDefinitions)
            .FirstOrDefaultAsync(p => p.Id == dto.ProductId, ct)
            ?? throw new InvalidOperationException("Product not found.");

        ValidatePersonalInfo(dto);
        ValidateFieldValues(dto.FieldValues, product.ProductType.FieldDefinitions);

        var now = DateTime.UtcNow;

        var application = new DomainApplication
        {
            ApplicationNumber = await NextApplicationNumberAsync(now.Year, ct),
            ProductId = dto.ProductId,
            CustomerName = dto.CustomerName.Trim(),
            CustomerEmail = dto.CustomerEmail.Trim(),
            CustomerPhone = dto.CustomerPhone.Trim(),
            CustomerDateOfBirth = dto.CustomerDateOfBirth,
            Status = dto.Submit ? SubmittedStatus : DraftStatus,
            CreatedAt = now,
            SubmittedAt = dto.Submit ? now : null,
            UpdatedAt = now
        };

        foreach (var fv in dto.FieldValues)
            application.FieldValues.Add(new ProductMarketplace.Domain.Entities.ApplicationFieldValue
            {
                ApplicationId = application.Id,
                FieldDefinitionId = fv.FieldDefinitionId,
                FieldKey = fv.FieldKey,
                FieldLabel = fv.FieldLabel,
                Value = fv.Value
            });

        foreach (var docName in dto.RequiredDocuments)
            application.Documents.Add(new ProductMarketplace.Domain.Entities.ApplicationDocument
            {
                ApplicationId = application.Id,
                DocumentName = docName,
                DocumentType = "General",
                Required = true,
                Uploaded = false
            });

        application.StatusHistory.Add(new ProductMarketplace.Domain.Entities.ApplicationStatusHistory
        {
            ApplicationId = application.Id,
            Status = DraftStatus,
            Note = "Application started",
            ChangedAt = now
        });
        if (dto.Submit)
        {
            application.StatusHistory.Add(new ProductMarketplace.Domain.Entities.ApplicationStatusHistory
            {
                ApplicationId = application.Id,
                Status = SubmittedStatus,
                Note = "Application submitted for review",
                ChangedAt = now
            });
        }

        _db.Applications.Add(application);
        await _db.SaveChangesAsync(ct);
        await RecalculateApplicationCountAsync(product, ct);
        await _audit.LogAsync(AuditActions.CreateApplication, AuditEntityTypes.Application, application.Id, application.ApplicationNumber,
            $"{application.CustomerName} submitted application {application.ApplicationNumber} for {product.Name}", ct: ct);
        return (await FullGraph().FirstAsync(a => a.Id == application.Id, ct)).ToDetailDto();
    }

    public async Task<ApplicationDetailDto?> UpdateStatusAsync(Guid id, ApplicationStatusUpdateDto dto, CancellationToken ct = default)
    {
        var application = await _db.Applications.Include(a => a.Product).FirstOrDefaultAsync(a => a.Id == id, ct);
        if (application is null) return null;

        await StatusValidation.EnsureValidAsync(_db, StatusEntityTypes.Application, dto.Status, ct);
        var newStatus = dto.Status;

        var wasSubmitted = application.Status != DraftStatus;
        var previousStatus = application.Status;

        application.Status = newStatus;
        application.UpdatedAt = DateTime.UtcNow;
        if (!wasSubmitted && newStatus != DraftStatus)
            application.SubmittedAt = DateTime.UtcNow;
        if (!string.IsNullOrWhiteSpace(dto.Note)) application.ReviewNotes = dto.Note;

        _db.ApplicationStatusHistories.Add(new ProductMarketplace.Domain.Entities.ApplicationStatusHistory
        {
            ApplicationId = id,
            Status = newStatus,
            Note = dto.Note ?? $"Status changed to {newStatus}",
            ChangedAt = DateTime.UtcNow
        });

        await _db.SaveChangesAsync(ct);
        await RecalculateApplicationCountAsync(application.Product, ct);
        await _audit.LogAsync(AuditActions.ApplicationStatusChange, AuditEntityTypes.Application, application.Id, application.ApplicationNumber,
            $"Application {application.ApplicationNumber} ({application.Product.Name}) status changed from {previousStatus} to {newStatus}",
            previousValue: previousStatus, newValue: newStatus.ToString(), ct: ct);
        return (await FullGraph().FirstAsync(a => a.Id == id, ct)).ToDetailDto();
    }

    public async Task<ApplicationDocumentDto?> UploadDocumentAsync(Guid applicationId, Guid documentId, string fileName, string contentType, long length, Stream content, CancellationToken ct = default)
    {
        var document = await _db.ApplicationDocuments.Include(d => d.Application)
            .FirstOrDefaultAsync(d => d.Id == documentId && d.ApplicationId == applicationId, ct);
        if (document is null) return null;

        if (length <= 0 || length > DocumentUploadConstraints.MaxFileSizeBytes)
            throw new InvalidOperationException($"File exceeds the {DocumentUploadConstraints.MaxFileSizeBytes / 1024 / 1024}MB limit.");

        var extension = Path.GetExtension(fileName);
        if (!DocumentUploadConstraints.AllowedExtensions.Contains(extension))
            throw new InvalidOperationException("Only PDF, JPG and PNG files are allowed.");

        // Read the file's own signature and trust that, not the browser's label.
        var header = new byte[8];
        var read = 0;
        while (read < header.Length)
        {
            var n = await content.ReadAsync(header.AsMemory(read), ct);
            if (n == 0) break;
            read += n;
        }

        var detected = DocumentUploadConstraints.DetectContentType(header.AsSpan(0, read))
            ?? throw new InvalidOperationException("This file is not a real PDF, JPG or PNG. Please upload the original document.");

        Stream body;
        if (content.CanSeek)
        {
            content.Seek(0, SeekOrigin.Begin);
            body = content;
        }
        else
        {
            body = new ConcatenatedStream(new MemoryStream(header, 0, read), content);
        }

        contentType = detected;
        if (!string.IsNullOrEmpty(document.StoragePath)) _fileStorage.Delete(document.StoragePath);
        var storagePath = await _fileStorage.SaveAsync(applicationId, documentId, fileName, body, ct);

        document.StoragePath = storagePath;
        document.FileName = fileName;
        document.ContentType = contentType;
        document.FileSizeBytes = length;
        document.Uploaded = true;
        document.UploadedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(AuditActions.UploadApplicationDocument, AuditEntityTypes.Application, applicationId, document.Application.ApplicationNumber,
            $"Uploaded document '{document.DocumentName}' ({fileName}) for application {document.Application.ApplicationNumber}", ct: ct);

        return document.ToDto();
    }

    public async Task<(Stream Stream, string ContentType, string FileName)?> GetDocumentFileAsync(Guid applicationId, Guid documentId, CancellationToken ct = default)
    {
        var document = await _db.ApplicationDocuments.FirstOrDefaultAsync(d => d.Id == documentId && d.ApplicationId == applicationId, ct);
        if (document is null || !document.Uploaded || string.IsNullOrEmpty(document.StoragePath)) return null;

        var stream = await _fileStorage.OpenReadAsync(document.StoragePath, ct);
        if (stream is null) return null;

        return (stream, document.ContentType ?? "application/octet-stream", document.FileName);
    }

    public async Task<ApplicationDocumentDto?> RemoveDocumentFileAsync(Guid applicationId, Guid documentId, CancellationToken ct = default)
    {
        var document = await _db.ApplicationDocuments.Include(d => d.Application)
            .FirstOrDefaultAsync(d => d.Id == documentId && d.ApplicationId == applicationId, ct);
        if (document is null) return null;

        if (!string.IsNullOrEmpty(document.StoragePath)) _fileStorage.Delete(document.StoragePath);

        document.StoragePath = null;
        document.ContentType = null;
        document.FileSizeBytes = null;
        document.FileName = string.Empty;
        document.Uploaded = false;
        document.UploadedAt = null;

        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(AuditActions.RemoveApplicationDocument, AuditEntityTypes.Application, applicationId, document.Application.ApplicationNumber,
            $"Removed uploaded document '{document.DocumentName}' from application {document.Application.ApplicationNumber}", ct: ct);

        return document.ToDto();
    }

    /// <summary>
    /// Derives the next application number from the highest number already issued for the year.
    /// Counting all rows instead (the previous approach) produced a number that had already been used
    /// as soon as the sequence and the row count diverged - across a year boundary, or after any row
    /// was removed - which the unique index on ApplicationNumber would then reject.
    /// </summary>
    private async Task<string> NextApplicationNumberAsync(int year, CancellationToken ct)
    {
        var prefix = $"APP-{year}-";
        var latest = await _db.Applications
            .Where(a => a.ApplicationNumber.StartsWith(prefix))
            .OrderByDescending(a => a.ApplicationNumber)
            .Select(a => a.ApplicationNumber)
            .FirstOrDefaultAsync(ct);

        var next = ApplicationNumberSeed;
        if (latest is not null && int.TryParse(latest[prefix.Length..], out var lastSequence))
            next = lastSequence + 1;

        return $"{prefix}{next}";
    }

    /// <summary>
    /// Product.ApplicationCount is denormalised so the database can sort and rank on it, but it is
    /// derived data. Recomputing it from the Applications table after every write means it can never
    /// drift out of step the way a blind increment could (double-counted transitions, rows changed by
    /// any other path, or a counter that has already gone wrong).
    /// </summary>
    private async Task RecalculateApplicationCountAsync(Product product, CancellationToken ct)
    {
        var count = await _db.Applications.CountAsync(a => a.ProductId == product.Id && a.Status != DraftStatus, ct);
        if (product.ApplicationCount == count) return;

        product.ApplicationCount = count;
        await _db.SaveChangesAsync(ct);
    }

    private static void ValidatePersonalInfo(ApplicationCreateDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.CustomerName) || !NameRegex().IsMatch(dto.CustomerName.Trim()))
            throw new InvalidOperationException("Please enter a valid full name.");
        if (string.IsNullOrWhiteSpace(dto.CustomerEmail) || !EmailRegex().IsMatch(dto.CustomerEmail.Trim()))
            throw new InvalidOperationException("Please enter a valid email address.");

        if (string.IsNullOrWhiteSpace(dto.CustomerPhone) || !PhoneRegex().IsMatch(dto.CustomerPhone.Trim()))
        {
            var digitsOnly = new string((dto.CustomerPhone ?? string.Empty).Where(char.IsDigit).ToArray());
            if (digitsOnly.Length < 7 || digitsOnly.Length > 15)
                throw new InvalidOperationException("Please enter a valid phone number with country code.");
        }

        if (dto.CustomerDateOfBirth is null)
            throw new InvalidOperationException("Date of birth is required.");
        if (dto.CustomerDateOfBirth.Value > DateOnly.FromDateTime(DateTime.UtcNow))
            throw new InvalidOperationException("Date of birth cannot be in the future.");
        if (dto.CustomerDateOfBirth.Value < new DateOnly(1900, 1, 1))
            throw new InvalidOperationException("Please enter a valid date of birth.");

        var requestedAmount = dto.FieldValues.FirstOrDefault(v => v.FieldKey == "requested_amount")?.Value;
        if (!string.IsNullOrWhiteSpace(requestedAmount) &&
            (!double.TryParse(requestedAmount, NumberStyles.Any, CultureInfo.InvariantCulture, out var amount) || amount <= 0))
            throw new InvalidOperationException("Requested amount must be a valid positive number.");
    }

    private static void ValidateFieldValues(List<ApplicationFieldValueInputDto> values, ICollection<FieldDefinition> definitions)
    {
        foreach (var def in definitions.Where(d => d.DisplayInApplication))
        {
            var value = values.FirstOrDefault(v => v.FieldDefinitionId == def.Id)?.Value?.Trim() ?? string.Empty;

            if (def.Required && string.IsNullOrWhiteSpace(value))
                throw new InvalidOperationException($"{def.Label} is required.");
            if (string.IsNullOrWhiteSpace(value)) continue;

            switch (def.DataType)
            {
                case FieldDataType.Number:
                case FieldDataType.Currency:
                    if (!double.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out var num) || num < 0)
                        throw new InvalidOperationException($"{def.Label} must be a valid positive number.");
                    break;
                case FieldDataType.Percentage:
                    if (!double.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out var pct) || pct < 0 || pct > 100)
                        throw new InvalidOperationException($"{def.Label} must be a number between 0 and 100.");
                    break;
                case FieldDataType.Date:
                    if (!DateOnly.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
                        throw new InvalidOperationException($"{def.Label} must be a valid date.");
                    break;
                case FieldDataType.Dropdown:
                    var options = string.IsNullOrWhiteSpace(def.OptionsJson) ? Array.Empty<string>() : JsonSerializer.Deserialize<string[]>(def.OptionsJson) ?? Array.Empty<string>();
                    if (options.Length > 0 && !options.Contains(value))
                        throw new InvalidOperationException($"{def.Label} has an invalid selection.");
                    break;
            }
        }
    }
}
