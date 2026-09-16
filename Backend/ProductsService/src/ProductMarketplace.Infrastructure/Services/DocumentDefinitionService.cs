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

    private IQueryable<DocumentDefinition> Base() => _db.DocumentDefinitions.Include(d => d.ProductType);

    /// <summary>
    /// With no productTypeId: returns the full admin catalog (every document, any scope).
    /// With a productTypeId: returns documents applicable to that type - i.e. scoped to it
    /// specifically, plus the global (ProductTypeId == null) ones - as used by the Apply Now flow.
    /// </summary>
    public async Task<List<DocumentDefinitionDto>> GetAllAsync(Guid? productTypeId, CancellationToken ct = default)
    {
        var q = Base().AsQueryable();
        if (productTypeId.HasValue)
            q = q.Where(d => d.Active && (d.ProductTypeId == productTypeId || d.ProductTypeId == null));

        var docs = await q.OrderBy(d => d.SortOrder).ThenBy(d => d.Name).ToListAsync(ct);
        return docs.Select(d => d.ToDto()).ToList();
    }

    public async Task<DocumentDefinitionDto> CreateAsync(DocumentDefinitionCreateUpdateDto dto, CancellationToken ct = default)
    {
        var doc = new DocumentDefinition
        {
            Name = dto.Name,
            DocumentType = dto.DocumentType,
            Required = dto.Required,
            SortOrder = dto.SortOrder,
            Active = dto.Active,
            ProductTypeId = dto.ProductTypeId,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        _db.DocumentDefinitions.Add(doc);
        await _db.SaveChangesAsync(ct);
        var created = await Base().FirstAsync(d => d.Id == doc.Id, ct);
        await _audit.LogAsync(AuditActions.CreateDocumentDefinition, AuditEntityTypes.DocumentDefinition, doc.Id, doc.Name, $"Added document requirement \"{doc.Name}\"", ct: ct);
        return created.ToDto();
    }

    public async Task<DocumentDefinitionDto?> UpdateAsync(Guid id, DocumentDefinitionCreateUpdateDto dto, CancellationToken ct = default)
    {
        var doc = await _db.DocumentDefinitions.FirstOrDefaultAsync(d => d.Id == id, ct);
        if (doc is null) return null;

        doc.Name = dto.Name;
        doc.DocumentType = dto.DocumentType;
        doc.Required = dto.Required;
        doc.SortOrder = dto.SortOrder;
        doc.Active = dto.Active;
        doc.ProductTypeId = dto.ProductTypeId;
        doc.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        await _audit.LogAsync(AuditActions.UpdateDocumentDefinition, AuditEntityTypes.DocumentDefinition, doc.Id, doc.Name, $"Updated document requirement \"{doc.Name}\"", ct: ct);
        return (await Base().FirstAsync(d => d.Id == id, ct)).ToDto();
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
}
