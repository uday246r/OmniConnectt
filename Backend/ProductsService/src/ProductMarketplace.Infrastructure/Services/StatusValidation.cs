using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Infrastructure.Data;

namespace ProductMarketplace.Infrastructure.Services;

/// <summary>Status values are no longer a closed C# enum - StatusConfig is the source of truth for
/// which values are valid per entity type. Any write that sets a status must go through this check
/// instead of Enum.Parse, so a value has to exist in Setup (built-in or admin-added) before it can be
/// stored on a real record. Read-side filters (search by ?status=) don't need this - an unknown value
/// there just yields zero matches.</summary>
internal static class StatusValidation
{
    public static async Task EnsureValidAsync(AppDbContext db, string entityType, string value, CancellationToken ct = default)
    {
        var config = await db.StatusConfigs.FirstOrDefaultAsync(s => s.EntityType == entityType && s.Value.ToLower() == value.ToLower(), ct);
        if (config is null)
        {
            var validStatuses = await db.StatusConfigs.Where(s => s.EntityType == entityType && s.Enabled).Select(s => s.Label).ToListAsync(ct);
            throw new InvalidOperationException($"'{value}' is not a valid status for {entityType}. Available statuses: {string.Join(", ", validStatuses)}.");
        }
        if (!config.Enabled)
        {
            throw new InvalidOperationException($"The status '{config.Label}' is currently disabled in Setup > Statuses.");
        }
    }

    public static async Task<string> ResolveDefaultAsync(AppDbContext db, string entityType, CancellationToken ct = default)
    {
        var value = await db.StatusConfigs
            .Where(s => s.EntityType == entityType && s.Enabled)
            .OrderBy(s => s.SortOrder)
            .Select(s => s.Value)
            .FirstOrDefaultAsync(ct);

        if (string.IsNullOrWhiteSpace(value))
            throw new InvalidOperationException($"No enabled {entityType} status is configured. Add one in Setup before creating {entityType} records.");

        return value;
    }

    public static async Task<string> EnsureValidOrDefaultAsync(AppDbContext db, string entityType, string? value, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(value))
            return await ResolveDefaultAsync(db, entityType, ct);

        await EnsureValidAsync(db, entityType, value, ct);
        return value;
    }
}
