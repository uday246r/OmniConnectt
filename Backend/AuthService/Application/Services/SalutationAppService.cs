using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using AuthService.Application.DTOs;
using AuthService.Application.Exceptions;
using AuthService.Domain.Entities;
using AuthService.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace AuthService.Application.Services;

/// <summary>The admin-configurable salutation list — see SalutationCatalog's doc comment.</summary>
/// <remarks>
/// <para>
/// Entries carry stable ids. The list used to be plain strings, so correcting "Mr" to "Mr." could only
/// be done as a removal and an addition: every user holding "Mr" kept it, and because it was no longer
/// in the list, those users could not be saved at all until someone noticed and changed their title.
/// A rename now updates the list, every user profile holding the old value, and any pending approval
/// request that would set it — in one transaction — and records one plain-language audit row.
/// </para>
/// <para>
/// Rows saved before ids existed hold a plain string array. They are read with ids derived from each
/// value, so they behave identically until the next save writes the new shape; no data migration is needed.
/// </para>
/// </remarks>
public class SalutationAppService(AuthDbContext db, AuditLogAppService auditLog)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static readonly string[] DefaultSalutations = ["Mr.", "Ms.", "Mrs.", "Dr."];

    public const int MaxLength = 20;

    private sealed record StoredEntry(string Id, string Value);

    public async Task<SalutationCatalogDto> GetAsync(CancellationToken ct = default)
    {
        var row = await db.SalutationCatalogs.AsNoTracking().OrderByDescending(c => c.UpdatedAt).FirstOrDefaultAsync(ct);
        var entries = row is null ? DefaultSalutations.Select(Legacy).ToList() : Parse(row.SalutationsJson);
        var usage = await CountUsageAsync(ct);

        return new SalutationCatalogDto(
            entries.Select(e => e.Value).ToList(),
            row?.Version ?? 0,
            row?.UpdatedAt ?? DateTimeOffset.UtcNow,
            entries.Select(e => new SalutationEntryDto(e.Id, e.Value, usage.GetValueOrDefault(e.Value))).ToList());
    }

    public async Task<IReadOnlyList<string>> GetSalutationsAsync(CancellationToken ct = default)
    {
        var row = await db.SalutationCatalogs.AsNoTracking().OrderByDescending(c => c.UpdatedAt).FirstOrDefaultAsync(ct);
        return (row is null ? DefaultSalutations.Select(Legacy).ToList() : Parse(row.SalutationsJson)).Select(e => e.Value).ToList();
    }

    /// <summary>How many user profiles show each salutation — so the editor can say "12 users will change" before a rename.</summary>
    public async Task<IReadOnlyDictionary<string, int>> CountUsageAsync(CancellationToken ct = default)
    {
        var counts = await db.Users.AsNoTracking()
            .Where(u => u.Salutation != null)
            .GroupBy(u => u.Salutation!)
            .Select(g => new { Value = g.Key, Count = g.Count() })
            .ToListAsync(ct);
        return counts.ToDictionary(c => c.Value, c => c.Count, StringComparer.Ordinal);
    }

    public async Task<SalutationCatalogDto> UpdateAsync(
        UpdateSalutationCatalogRequest request, Guid? actingUserId, CancellationToken ct = default)
    {
        var strategy = db.Database.CreateExecutionStrategy();
        var (renames, added, removed, version, affectedUsers) = await strategy.ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = db.Database.IsRelational() ? await db.Database.BeginTransactionAsync(ct) : null;

            var row = await db.SalutationCatalogs.OrderByDescending(c => c.UpdatedAt).FirstOrDefaultAsync(ct);
            var current = row is null ? DefaultSalutations.Select(Legacy).ToList() : Parse(row.SalutationsJson);
            var currentVersion = row?.Version ?? 0;

            if (request.ExpectedVersion is { } expected && expected != currentVersion)
            {
                throw new ConflictAppException(
                    "Someone else changed the salutation list while you were editing it. Reload to see their changes, then make yours again.");
            }

            var next = Resolve(request, current);
            var currentById = current.ToDictionary(e => e.Id);
            var nextIds = next.Select(e => e.Id).ToHashSet();

            var renamedEntries = next
                .Where(e => currentById.TryGetValue(e.Id, out var old) && !string.Equals(old.Value, e.Value, StringComparison.Ordinal))
                .Select(e => (From: currentById[e.Id].Value, To: e.Value))
                .ToList();
            var addedValues = next.Where(e => !currentById.ContainsKey(e.Id)).Select(e => e.Value).ToList();
            var removedValues = current.Where(e => !nextIds.Contains(e.Id)).Select(e => e.Value).ToList();

            var now = DateTimeOffset.UtcNow;
            var json = JsonSerializer.Serialize(next, JsonOptions);
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

            var affected = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (var (from, to) in renamedEntries)
            {
                // Deleted users too: restoring one must not bring back a title that no longer exists.
                var holders = await db.Users.IgnoreQueryFilters().Where(u => u.Salutation == from).ToListAsync(ct);
                foreach (var user in holders)
                {
                    user.Salutation = to;
                    user.UpdatedAt = now;
                    user.UpdatedBy = actingUserId;
                }
                affected[from] = holders.Count(u => !u.IsDeleted);

                await RewritePendingSnapshotsAsync(from, to, ct);
            }

            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateConcurrencyException)
            {
                throw new ConflictAppException(
                    "Someone else changed the salutation list while you were saving. Reload to see their changes, then make yours again.");
            }

            if (transaction is not null) await transaction.CommitAsync(ct);
            return (renamedEntries, addedValues, removedValues, row.Version, affected);
        });

        await WriteAuditAsync(actingUserId, renames, added, removed, affectedUsers, ct);

        return await GetAsync(ct);
    }

    /// <summary>
    /// A pending "create/edit user" request that would set the old title is changed to set the new one —
    /// otherwise approving it after the rename would fail, or bring the old title back.
    /// </summary>
    private async Task RewritePendingSnapshotsAsync(string from, string to, CancellationToken ct)
    {
        var pending = await db.ApprovalRequests
            .Where(r => r.Module == ApprovalModuleKeys.Users && r.Status == ApprovalStatus.Pending && r.NewDataJson.Contains(from))
            .ToListAsync(ct);

        foreach (var request in pending)
        {
            if (JsonNode.Parse(request.NewDataJson) is not JsonObject snapshot) continue;
            var key = snapshot.Select(p => p.Key).FirstOrDefault(k => string.Equals(k, "Salutation", StringComparison.OrdinalIgnoreCase));
            if (key is null || snapshot[key]?.GetValueKind() != JsonValueKind.String || snapshot[key]!.GetValue<string>() != from) continue;

            snapshot[key] = to;
            request.NewDataJson = snapshot.ToJsonString();
        }
    }

    private async Task WriteAuditAsync(
        Guid? actingUserId, List<(string From, string To)> renames, List<string> added, List<string> removed,
        Dictionary<string, int> affectedUsers, CancellationToken ct)
    {
        var actorName = actingUserId is null
            ? null
            : await db.Users.AsNoTracking().Where(u => u.Id == actingUserId).Select(u => u.Name).FirstOrDefaultAsync(ct);

        foreach (var (from, to) in renames)
        {
            var count = affectedUsers.GetValueOrDefault(from);
            var people = count switch
            {
                0 => "No user profiles used it.",
                1 => $"1 user profile now shows '{to}'.",
                _ => $"{count} user profiles now show '{to}'.",
            };
            await auditLog.WriteHostAsync(
                actingUserId, actorName, "salutation_catalog.renamed",
                AuditLogAppService.Modules.UserSchema, AuditLogAppService.Categories.Configuration,
                entityType: "SalutationCatalog", entityLabel: "Salutations",
                details: $"Renamed the salutation '{from}' to '{to}'. {people}",
                page: "settings/fields", ct: ct);
        }

        if (added.Count > 0 || removed.Count > 0)
        {
            var parts = new List<string>();
            if (added.Count > 0) parts.Add($"Added {Quote(added)}.");
            if (removed.Count > 0) parts.Add($"Removed {Quote(removed)}. Users who already have {(removed.Count == 1 ? "it" : "one of them")} keep it until their profile is changed.");
            await auditLog.WriteHostAsync(
                actingUserId, actorName, "salutation_catalog.updated",
                AuditLogAppService.Modules.UserSchema, AuditLogAppService.Categories.Configuration,
                entityType: "SalutationCatalog", entityLabel: "Salutations",
                details: string.Join(" ", parts), page: "settings/fields", ct: ct);
        }

        static string Quote(List<string> values) => string.Join(", ", values.Select(v => $"'{v}'"));
    }

    private static List<StoredEntry> Resolve(UpdateSalutationCatalogRequest request, List<StoredEntry> current)
    {
        List<StoredEntry> next;
        if (request.Entries is not null)
        {
            next = request.Entries
                .Select(e => new StoredEntry(string.IsNullOrWhiteSpace(e.Id) ? Guid.NewGuid().ToString("N") : e.Id.Trim(), (e.Value ?? string.Empty).Trim()))
                .ToList();
        }
        else
        {
            var byValue = current.ToDictionary(e => e.Value, StringComparer.Ordinal);
            next = (request.Salutations ?? [])
                .Select(v => v.Trim())
                .Select(v => byValue.TryGetValue(v, out var existing) ? existing : new StoredEntry(Guid.NewGuid().ToString("N"), v))
                .ToList();
        }

        next = next.Where(e => e.Value.Length > 0).ToList();

        if (next.Count == 0)
        {
            throw new ValidationAppException("At least one salutation is required.");
        }

        if (next.Any(e => e.Value.Length > MaxLength))
        {
            throw new ValidationAppException($"A salutation cannot exceed {MaxLength} characters.");
        }

        if (next.Select(e => e.Value).Distinct(StringComparer.OrdinalIgnoreCase).Count() != next.Count)
        {
            throw new ValidationAppException("The salutation list has a duplicate entry.");
        }

        if (next.Select(e => e.Id).Distinct().Count() != next.Count)
        {
            throw new ValidationAppException("The same salutation appears twice in the request.");
        }

        return next;
    }

    private static List<StoredEntry> Parse(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.EnumerateArray()
            .Select(element => element.ValueKind == JsonValueKind.String
                ? Legacy(element.GetString() ?? string.Empty)
                : new StoredEntry(
                    element.TryGetProperty("id", out var id) ? id.GetString() ?? string.Empty : string.Empty,
                    element.TryGetProperty("value", out var value) ? value.GetString() ?? string.Empty : string.Empty))
            .Where(e => e.Value.Length > 0)
            .Select(e => e.Id.Length > 0 ? e : Legacy(e.Value))
            .ToList();
    }

    /// <summary>An id for a value saved before ids existed: derived from the value, so it is the same on every read.</summary>
    private static StoredEntry Legacy(string value) =>
        new(Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)))[..32].ToLowerInvariant(), value);
}
