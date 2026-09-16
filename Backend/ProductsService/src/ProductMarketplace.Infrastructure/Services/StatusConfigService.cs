using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Application.Common;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;
using ProductMarketplace.Domain.Entities;
using ProductMarketplace.Infrastructure.Data;

namespace ProductMarketplace.Infrastructure.Services;

public partial class StatusConfigService : IStatusConfigService
{
    private static readonly HashSet<string> ValidEntityTypes = new()
    {
        StatusEntityTypes.Product, StatusEntityTypes.Category, StatusEntityTypes.Review,
        StatusEntityTypes.Promotion, StatusEntityTypes.Application
    };

    [GeneratedRegex(@"^[A-Za-z][A-Za-z0-9]*$")]
    private static partial Regex ValueRegex();

    private readonly AppDbContext _db;
    private readonly IAuditLogService _audit;
    public StatusConfigService(AppDbContext db, IAuditLogService audit)
    {
        _db = db;
        _audit = audit;
    }

    public async Task<List<StatusConfigDto>> GetAllAsync(string? entityType, CancellationToken ct = default)
    {
        var q = _db.StatusConfigs.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(entityType)) q = q.Where(s => s.EntityType == entityType);

        var rows = await q.OrderBy(s => s.EntityType).ThenBy(s => s.SortOrder).ToListAsync(ct);
        return rows.Select(s => s.ToDto()).ToList();
    }

    public async Task<StatusConfigDto> CreateAsync(StatusConfigCreateDto dto, CancellationToken ct = default)
    {
        if (!ValidEntityTypes.Contains(dto.EntityType))
            throw new InvalidOperationException($"'{dto.EntityType}' is not a valid entity type.");

        var value = dto.Value.Trim();
        if (!ValueRegex().IsMatch(value))
            throw new InvalidOperationException("Status value must start with a letter and contain only letters and numbers (no spaces or symbols).");

        if (string.IsNullOrWhiteSpace(dto.Label))
            throw new InvalidOperationException("Label is required.");

        var exists = await _db.StatusConfigs.AnyAsync(s => s.EntityType == dto.EntityType && s.Value == value, ct);
        if (exists)
            throw new InvalidOperationException($"A '{value}' status already exists for {dto.EntityType}.");

        var config = new StatusConfig
        {
            EntityType = dto.EntityType,
            Value = value,
            Label = dto.Label.Trim(),
            Color = dto.Color,
            Enabled = dto.Enabled,
            SortOrder = dto.SortOrder
        };
        _db.StatusConfigs.Add(config);
        await _db.SaveChangesAsync(ct);

        await _audit.LogAsync(AuditActions.CreateStatusConfig, AuditEntityTypes.StatusConfig, config.Id, $"{config.EntityType}.{config.Value}",
            $"Created status \"{config.Label}\" ({config.Value}) for {config.EntityType}", ct: ct);
        return config.ToDto();
    }

    public async Task<StatusConfigDto?> UpdateAsync(Guid id, StatusConfigUpdateDto dto, CancellationToken ct = default)
    {
        var config = await _db.StatusConfigs.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (config is null) return null;

        config.Label = dto.Label;
        config.Color = dto.Color;
        config.Enabled = dto.Enabled;
        config.SortOrder = dto.SortOrder;
        await _db.SaveChangesAsync(ct);

        await _audit.LogAsync(AuditActions.UpdateStatusConfig, AuditEntityTypes.StatusConfig, config.Id, $"{config.EntityType}.{config.Value}",
            $"Updated status display for {config.EntityType} \"{config.Value}\" (label: \"{config.Label}\", enabled: {config.Enabled})", ct: ct);
        return config.ToDto();
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var config = await _db.StatusConfigs.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (config is null) return false;

        _db.StatusConfigs.Remove(config);
        await _db.SaveChangesAsync(ct);

        await _audit.LogAsync(AuditActions.DeleteStatusConfig, AuditEntityTypes.StatusConfig, config.Id, $"{config.EntityType}.{config.Value}",
            $"Deleted status \"{config.Label}\" ({config.Value}) from {config.EntityType}", ct: ct);
        return true;
    }
}
