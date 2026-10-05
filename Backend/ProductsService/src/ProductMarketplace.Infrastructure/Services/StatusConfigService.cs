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
        if (!StatusEntityTypes.All.Contains(dto.EntityType))
            throw new InvalidOperationException($"'{dto.EntityType}' is not a valid entity type. Choose one of: {string.Join(", ", StatusEntityTypes.All)}.");

        var value = dto.Value.Trim();
        if (!ValueRegex().IsMatch(value))
            throw new InvalidOperationException("Status value must start with a letter and contain only letters and numbers (no spaces or symbols).");

        if (string.IsNullOrWhiteSpace(dto.Label))
            throw new InvalidOperationException("Label is required.");

        if (string.IsNullOrWhiteSpace(dto.Color))
            throw new InvalidOperationException("Choose a colour for this status.");

        var exists = await _db.StatusConfigs.AnyAsync(s => s.EntityType == dto.EntityType && s.Value.ToLower() == value.ToLower(), ct);
        if (exists)
            throw new InvalidOperationException($"A '{value}' status already exists for {dto.EntityType}.");

        var config = new StatusConfig
        {
            EntityType = dto.EntityType,
            Value = value,
            Label = dto.Label.Trim(),
            Color = dto.Color.Trim(),
            Enabled = dto.Enabled,
            IsLive = dto.IsLive,
            SortOrder = dto.SortOrder
        };
        _db.StatusConfigs.Add(config);
        await _db.SaveOrReportDuplicateAsync($"A '{value}' status already exists for {dto.EntityType}.", ct);

        await _audit.LogAsync(AuditActions.CreateStatusConfig, AuditEntityTypes.StatusConfig, config.Id, $"{config.EntityType}.{config.Value}",
            $"Created status \"{config.Label}\" ({config.Value}) for {config.EntityType}", ct: ct);
        return config.ToDto();
    }

    public async Task<StatusConfigDto?> UpdateAsync(Guid id, StatusConfigUpdateDto dto, CancellationToken ct = default)
    {
        var config = await _db.StatusConfigs.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (config is null) return null;

        if (string.IsNullOrWhiteSpace(dto.Label))
            throw new InvalidOperationException("Label is required.");
        if (string.IsNullOrWhiteSpace(dto.Color))
            throw new InvalidOperationException("Choose a colour for this status.");

        // A status that stops being live, or is switched off, must leave the entity type another live one.
        var staysLive = dto.IsLive && dto.Enabled;
        if (config.IsLive && !staysLive)
            await EnsureAnotherLiveStatusAsync(config, "make this status not live", ct);

        config.Label = dto.Label.Trim();
        config.Color = dto.Color.Trim();
        config.Enabled = dto.Enabled;
        config.IsLive = dto.IsLive;
        config.SortOrder = dto.SortOrder;
        await _db.SaveChangesAsync(ct);

        await _audit.LogAsync(AuditActions.UpdateStatusConfig, AuditEntityTypes.StatusConfig, config.Id, $"{config.EntityType}.{config.Value}",
            $"Updated status {config.EntityType} \"{config.Value}\" (label: \"{config.Label}\", enabled: {config.Enabled}, live: {config.IsLive})", ct: ct);
        return config.ToDto();
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var config = await _db.StatusConfigs.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (config is null) return false;

        // Records keep the status they hold; deleting its definition would leave them with a value Setup no
        // longer knows, which they could not be saved out of.
        var inUse = config.EntityType switch
        {
            StatusEntityTypes.Product => await _db.Products.CountAsync(p => p.Status == config.Value, ct),
            StatusEntityTypes.SubCategory => await _db.SubCategories.CountAsync(s => s.Status == config.Value, ct),
            StatusEntityTypes.Category => await _db.Categories.CountAsync(c => c.Status == config.Value, ct),
            _ => 0
        };
        if (inUse > 0)
            throw new InvalidOperationException($"Cannot delete the status \"{config.Label}\": {inUse} {config.EntityType.ToLowerInvariant()} record{(inUse == 1 ? " has" : "s have")} it. Move them to another status first, or disable it instead.");

        if (config.IsLive) await EnsureAnotherLiveStatusAsync(config, "delete this status", ct);

        _db.StatusConfigs.Remove(config);
        await _db.SaveChangesAsync(ct);

        await _audit.LogAsync(AuditActions.DeleteStatusConfig, AuditEntityTypes.StatusConfig, config.Id, $"{config.EntityType}.{config.Value}",
            $"Deleted status \"{config.Label}\" ({config.Value}) from {config.EntityType}", ct: ct);
        return true;
    }

    /// <summary>
    /// Without a live status for an entity type, nothing of that type could be shown — the whole catalogue
    /// would disappear on one click in Setup.
    /// </summary>
    private async Task EnsureAnotherLiveStatusAsync(StatusConfig changing, string action, CancellationToken ct)
    {
        var another = await _db.StatusConfigs.AnyAsync(s => s.Id != changing.Id && s.EntityType == changing.EntityType && s.IsLive && s.Enabled, ct);
        if (!another)
            throw new InvalidOperationException($"Cannot {action}: it is the only live status for {changing.EntityType}, and without one nothing would be shown in the catalogue. Make another status live first.");
    }
}
