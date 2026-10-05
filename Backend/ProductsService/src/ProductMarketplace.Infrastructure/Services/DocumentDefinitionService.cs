using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Application.Common;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;
using ProductMarketplace.Domain.Entities;
using ProductMarketplace.Infrastructure.Data;

namespace ProductMarketplace.Infrastructure.Services;

public class DocumentDefinitionService : IDocumentDefinitionService
{
    private readonly AppDbContext _db;
    private readonly IAuditLogService _audit;
    public DocumentDefinitionService(AppDbContext db, IAuditLogService audit)
    {
        _db = db;
        _audit = audit;
    }

    private IQueryable<DocumentDefinition> Base() => _db.DocumentDefinitions.Include(d => d.SubCategory);

    /// <summary>
    /// With no subCategoryId: returns the full admin catalog (every document, any scope).
    /// With a subCategoryId: returns the active documents applicable to it - scoped to it specifically,
    /// plus the global (SubCategoryId == null) ones.
    /// </summary>
    public async Task<List<DocumentDefinitionDto>> GetAllAsync(Guid? subCategoryId, CancellationToken ct = default)
    {
        var q = Base().AsNoTracking();
        if (subCategoryId.HasValue)
            q = q.Where(d => d.Active && (d.SubCategoryId == subCategoryId || d.SubCategoryId == null));

        var docs = await q.OrderBy(d => d.SortOrder).ThenBy(d => d.Name).ToListAsync(ct);
        return docs.Select(d => d.ToDto()).ToList();
    }

    public async Task<DocumentDefinitionDto> CreateAsync(DocumentDefinitionCreateUpdateDto dto, CancellationToken ct = default)
    {
        await EnsureScopeExistsAsync(dto.SubCategoryId, ct);
        var doc = new DocumentDefinition
        {
            Name = dto.Name.Trim(),
            DocumentType = dto.DocumentType.Trim(),
            Required = dto.Required,
            SortOrder = dto.SortOrder,
            Active = dto.Active,
            SubCategoryId = dto.SubCategoryId,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        _db.DocumentDefinitions.Add(doc);
        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(AuditActions.CreateDocumentDefinition, AuditEntityTypes.DocumentDefinition, doc.Id, doc.Name, $"Added document requirement \"{doc.Name}\"", ct: ct);
        return (await Base().AsNoTracking().FirstAsync(d => d.Id == doc.Id, ct)).ToDto();
    }

    public async Task<DocumentDefinitionDto?> UpdateAsync(Guid id, DocumentDefinitionCreateUpdateDto dto, CancellationToken ct = default)
    {
        var doc = await _db.DocumentDefinitions.FirstOrDefaultAsync(d => d.Id == id, ct);
        if (doc is null) return null;

        await EnsureScopeExistsAsync(dto.SubCategoryId, ct);
        doc.Name = dto.Name.Trim();
        doc.DocumentType = dto.DocumentType.Trim();
        doc.Required = dto.Required;
        doc.SortOrder = dto.SortOrder;
        doc.Active = dto.Active;
        doc.SubCategoryId = dto.SubCategoryId;
        doc.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(AuditActions.UpdateDocumentDefinition, AuditEntityTypes.DocumentDefinition, doc.Id, doc.Name, $"Updated document requirement \"{doc.Name}\"", ct: ct);
        return (await Base().AsNoTracking().FirstAsync(d => d.Id == id, ct)).ToDto();
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var doc = await _db.DocumentDefinitions.FirstOrDefaultAsync(d => d.Id == id, ct);
        if (doc is null) return false;
        _db.DocumentDefinitions.Remove(doc);
        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(AuditActions.DeleteDocumentDefinition, AuditEntityTypes.DocumentDefinition, id, doc.Name, $"Deleted document requirement \"{doc.Name}\"", ct: ct);
        return true;
    }

    private async Task EnsureScopeExistsAsync(Guid? subCategoryId, CancellationToken ct)
    {
        if (subCategoryId.HasValue && !await _db.SubCategories.AnyAsync(s => s.Id == subCategoryId, ct))
            throw new InvalidOperationException("Choose an existing sub-category, or leave it empty for a document every product needs.");
    }
}
