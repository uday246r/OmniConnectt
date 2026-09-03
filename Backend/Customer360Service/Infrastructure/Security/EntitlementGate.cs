using System.Net.Http.Json;
using backend.Options;
using Microsoft.Extensions.Options;

namespace backend.Infrastructure.Security;

/// <summary>
/// Whether this deployment is licensed for a feature. AuthService owns the answer; this caches it.
/// </summary>
/// <remarks>
/// This file is deliberately duplicated in AuthService, ModuleRegistry, LeadService and
/// Customer360Service rather than shared through a class library, matching how
/// RequiresCapabilityAttribute is already duplicated across all four. Each service builds from its
/// own Docker context (see render.yaml), so a shared project would mean editing four Dockerfiles —
/// deployment work that is deliberately out of scope for this change. Consolidate when it isn't.
///
/// Keep the semantics here identical to AuthService's EntitlementResolver; that is the reference
/// implementation and the one with the test suite.
/// </remarks>
public sealed record EntitlementEntry(
    string FeatureKey,
    string Status,
    string Visibility,
    string? PlanTier,
    string? LockReason,
    DateTimeOffset? ExpiresAt);

public sealed class EntitlementGate(
    IHttpClientFactory httpClientFactory,
    IOptions<AuthIntegrationOptions> options,
    IConfiguration configuration,
    ILogger<EntitlementGate> logger)
{
    private static readonly TimeSpan RefreshInterval = TimeSpan.FromSeconds(30);

    private readonly AuthIntegrationOptions _options = options.Value;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private Dictionary<string, EntitlementEntry> _map = new(StringComparer.OrdinalIgnoreCase);
    private DateTimeOffset _loadedAt = DateTimeOffset.MinValue;

    private sealed record SnapshotResponse(DateTimeOffset GeneratedAt, List<EntitlementEntry> Entries);

    /// <summary>
    /// True when the feature may be used. Checks the whole ancestor chain, so an unlicensed
    /// <c>remote.lead</c> blocks <c>remote.lead.dashboard</c> without needing its own row.
    /// </summary>
    public async Task<(bool Allowed, string? LockReason)> IsAllowedAsync(string featureKey, CancellationToken ct)
    {
        if (!configuration.GetValue("Entitlements:Enforce", true))
        {
            return (true, null);
        }

        var map = await GetMapAsync(ct);

        var key = featureKey;
        while (true)
        {
            if (map.TryGetValue(key, out var entry))
            {
                var expired = !string.Equals(entry.Status, "Unlicensed", StringComparison.OrdinalIgnoreCase)
                              && entry.ExpiresAt is { } expiry
                              && expiry <= DateTimeOffset.UtcNow;

                var unlicensed = expired
                    || string.Equals(entry.Status, "Unlicensed", StringComparison.OrdinalIgnoreCase);

                // Hidden is refused exactly like Locked: hiding a module from the navigation tree is
                // presentation, not enforcement, and a caller who types the URL must still be refused.
                var blocked = unlicensed
                    || string.Equals(entry.Visibility, "Locked", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(entry.Visibility, "Hidden", StringComparison.OrdinalIgnoreCase);

                return blocked ? (false, entry.LockReason) : (true, null);
            }

            var lastDot = key.LastIndexOf('.');
            if (lastDot <= 0) return (true, null); // No row anywhere up the chain — fails open, by design.
            key = key[..lastDot];
        }
    }

    private async Task<Dictionary<string, EntitlementEntry>> GetMapAsync(CancellationToken ct)
    {
        if (DateTimeOffset.UtcNow - _loadedAt < RefreshInterval) return _map;

        await _gate.WaitAsync(ct);
        try
        {
            if (DateTimeOffset.UtcNow - _loadedAt < RefreshInterval) return _map;

            if (string.IsNullOrWhiteSpace(_options.BaseUrl))
            {
                // Unconfigured is not the same as unlicensed. Refusing everything here would make a
                // missing environment variable look exactly like an expired contract.
                _loadedAt = DateTimeOffset.UtcNow;
                return _map;
            }

            using var client = httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(5);

            using var request = new HttpRequestMessage(HttpMethod.Get, $"{_options.BaseUrl.TrimEnd('/')}/internal/entitlements");
            request.Headers.Add("X-Internal-Api-Key", _options.InternalApiKey);

            using var response = await client.SendAsync(request, ct);
            response.EnsureSuccessStatusCode();

            var payload = await response.Content.ReadFromJsonAsync<SnapshotResponse>(ct);
            if (payload is not null)
            {
                _map = payload.Entries.ToDictionary(e => e.FeatureKey, StringComparer.OrdinalIgnoreCase);
                _loadedAt = DateTimeOffset.UtcNow;
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Keep the previous map. Discarding it would empty the gate, and an empty map means
            // "everything licensed" — so a transient AuthService blip would silently unlock the
            // product. _loadedAt is left alone so the next request retries rather than waiting out
            // a full interval on stale data.
            logger.LogWarning(ex, "Could not refresh the entitlement snapshot from AuthService; keeping the previous one.");
        }
        finally
        {
            _gate.Release();
        }

        return _map;
    }
}
