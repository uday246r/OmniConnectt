using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Application.Common;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;
using ProductMarketplace.Domain.Entities;
using ProductMarketplace.Infrastructure.Data;

namespace ProductMarketplace.Infrastructure.Services;

public class EmploymentTypeService : IEmploymentTypeService
{
    private readonly AppDbContext _db;
    private readonly IAuditLogService _audit;

    public EmploymentTypeService(AppDbContext db, IAuditLogService audit)
    {
        _db = db;
        _audit = audit;
    }

    public async Task<List<EmploymentTypeDto>> GetAllAsync(bool? activeOnly = null, CancellationToken ct = default)
    {
        var q = _db.EmploymentTypes.AsNoTracking().AsQueryable();
        if (activeOnly.HasValue && activeOnly.Value)
        {
            q = q.Where(e => e.Active);
        }

        var rows = await q.OrderBy(e => e.SortOrder).ThenBy(e => e.Name).ToListAsync(ct);
        return rows.Select(e => e.ToDto()).ToList();
    }

    public async Task<EmploymentTypeDto?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        var entity = await _db.EmploymentTypes.AsNoTracking().FirstOrDefaultAsync(e => e.Id == id, ct);
        return entity?.ToDto();
    }

    public async Task<EmploymentTypeDto> CreateAsync(EmploymentTypeCreateUpdateDto dto, CancellationToken ct = default)
    {
        var name = dto.Name?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(name))
            throw new InvalidOperationException("Employment type name is required.");

        var exists = await _db.EmploymentTypes.AnyAsync(e => e.Name.ToLower() == name.ToLower(), ct);
        if (exists)
            throw new InvalidOperationException($"An employment type with the name \"{name}\" already exists.");

        var entity = new EmploymentType
        {
            Name = name,
            Active = dto.Active,
            SortOrder = dto.SortOrder,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        _db.EmploymentTypes.Add(entity);
        await _db.SaveChangesAsync(ct);

        await _audit.LogAsync(
            AuditActions.CreateEmploymentType,
            AuditEntityTypes.EmploymentType,
            entity.Id,
            entity.Name,
            $"Created employment type \"{entity.Name}\"",
            ct: ct);

        return entity.ToDto();
    }

    public async Task<EmploymentTypeDto?> UpdateAsync(Guid id, EmploymentTypeCreateUpdateDto dto, CancellationToken ct = default)
    {
        var entity = await _db.EmploymentTypes.FirstOrDefaultAsync(e => e.Id == id, ct);
        if (entity is null) return null;

        var name = dto.Name?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(name))
            throw new InvalidOperationException("Employment type name is required.");

        var duplicate = await _db.EmploymentTypes.AnyAsync(e => e.Id != id && e.Name.ToLower() == name.ToLower(), ct);
        if (duplicate)
            throw new InvalidOperationException($"Another employment type with the name \"{name}\" already exists.");

        var prev = entity.Name;
        entity.Name = name;
        entity.Active = dto.Active;
        entity.SortOrder = dto.SortOrder;
        entity.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);

        await _audit.LogAsync(
            AuditActions.UpdateEmploymentType,
            AuditEntityTypes.EmploymentType,
            entity.Id,
            entity.Name,
            $"Updated employment type \"{prev}\" to \"{entity.Name}\" (Active: {entity.Active}, SortOrder: {entity.SortOrder})",
            ct: ct);

        return entity.ToDto();
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var entity = await _db.EmploymentTypes.FirstOrDefaultAsync(e => e.Id == id, ct);
        if (entity is null) return false;

        _db.EmploymentTypes.Remove(entity);
        await _db.SaveChangesAsync(ct);

        await _audit.LogAsync(
            AuditActions.DeleteEmploymentType,
            AuditEntityTypes.EmploymentType,
            entity.Id,
            entity.Name,
            $"Deleted employment type \"{entity.Name}\"",
            ct: ct);

        return true;
    }
}
