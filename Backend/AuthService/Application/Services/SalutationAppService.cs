using System.Text.Json;
using AuthService.Application.DTOs;
using AuthService.Application.Exceptions;
using AuthService.Domain.Entities;
using AuthService.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace AuthService.Application.Services;

/// <summary>CRUD for the admin-configurable salutation list — see SalutationCatalog's doc comment.</summary>
public class SalutationAppService(AuthDbContext db)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static readonly string[] DefaultSalutations = ["Mr.", "Ms.", "Mrs.", "Dr."];

    public async Task<SalutationCatalogDto> GetAsync(CancellationToken ct = default)
    {
        var row = await db.SalutationCatalogs.AsNoTracking().OrderByDescending(c => c.UpdatedAt).FirstOrDefaultAsync(ct);
        if (row is null)
        {
            return new SalutationCatalogDto(DefaultSalutations, 0, DateTimeOffset.UtcNow);
        }

        var salutations = JsonSerializer.Deserialize<List<string>>(row.SalutationsJson, JsonOptions) ?? [];
        return new SalutationCatalogDto(salutations, row.Version, row.UpdatedAt);
    }

    public async Task<IReadOnlyList<string>> GetSalutationsAsync(CancellationToken ct = default)
        => (await GetAsync(ct)).Salutations;

    public async Task<SalutationCatalogDto> UpdateAsync(
        UpdateSalutationCatalogRequest request, Guid? actingUserId, CancellationToken ct = default)
    {
        var cleaned = ValidateShape(request.Salutations);

        var row = await db.SalutationCatalogs.OrderByDescending(c => c.UpdatedAt).FirstOrDefaultAsync(ct);
        var now = DateTimeOffset.UtcNow;
        var json = JsonSerializer.Serialize(cleaned, JsonOptions);

        if (row is null)
        {
            row = new SalutationCatalog { Id = Guid.NewGuid(), SalutationsJson = json, Version = 1, UpdatedAt = now, UpdatedBy = actingUserId };
            db.SalutationCatalogs.Add(row);
        }
        else
        {
            row.SalutationsJson = json;
            row.Version += 1;
            row.UpdatedAt = now;
            row.UpdatedBy = actingUserId;
        }

        await db.SaveChangesAsync(ct);
        return new SalutationCatalogDto(cleaned, row.Version, row.UpdatedAt);
    }

    private static List<string> ValidateShape(IReadOnlyList<string> salutations)
    {
        var cleaned = salutations.Select(s => s.Trim()).Where(s => s.Length > 0).ToList();

        if (cleaned.Count == 0)
        {
            throw new ValidationAppException("At least one salutation is required.");
        }

        if (cleaned.Any(s => s.Length > 20))
        {
            throw new ValidationAppException("A salutation cannot exceed 20 characters.");
        }

        var distinct = new HashSet<string>(cleaned, StringComparer.OrdinalIgnoreCase);
        if (distinct.Count != cleaned.Count)
        {
            throw new ValidationAppException("The salutation list has a duplicate entry.");
        }

        return cleaned;
    }
}
