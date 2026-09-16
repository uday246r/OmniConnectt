using System.Net.Http.Json;
using LeadManagement.Api.Options;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace LeadManagement.Api.Infrastructure;

/// <summary>
/// The formats administrators defined in Settings → Manage Formats, read from AuthService.
/// </summary>
/// <remarks>
/// <para>
/// Cached briefly, because every lead create and edit validates against it and formats change rarely.
/// A format edited in Manage Formats is in force here within <see cref="CacheFor"/>.
/// </para>
/// <para>
/// When AuthService cannot be reached, the last catalog successfully read is used. With none at all
/// the result is empty: fields that use an admin-defined format are then not checked against it (they
/// fail open, as the engine does for any unknown format), while built-in formats — email, phone,
/// patterns — are still enforced. An outage of the settings service must not stop lead capture.
/// </para>
/// </remarks>
public class ValidationPresetClient(
    HttpClient httpClient,
    IOptions<AuthIntegrationOptions> options,
    IMemoryCache cache,
    ValidationPresetClient.LastKnownGood lastKnownGood,
    ILogger<ValidationPresetClient> logger)
{
    public static readonly TimeSpan CacheFor = TimeSpan.FromSeconds(60);
    private const string CacheKey = "validation-presets:v1";

    /// <summary>Survives the scoped client; one per process.</summary>
    public sealed class LastKnownGood
    {
        private volatile IReadOnlyList<FormatPreset>? presets;

        public IReadOnlyList<FormatPreset>? Value => presets;

        public void Set(IReadOnlyList<FormatPreset> value) => presets = value;
    }

    private sealed record CatalogResponse(List<PresetResponse>? Presets);

    private sealed record PresetResponse(
        string Key, string Label, string Kind, string? Pattern, int? MinLength, int? MaxLength,
        decimal? MinValue, decimal? MaxValue, string Message, string? TextMode);

    public async Task<IReadOnlyList<FormatPreset>> GetAsync(CancellationToken ct = default)
    {
        if (cache.TryGetValue(CacheKey, out IReadOnlyList<FormatPreset>? cached) && cached is not null)
        {
            return cached;
        }

        var settings = options.Value;
        if (string.IsNullOrWhiteSpace(settings.BaseUrl))
        {
            return lastKnownGood.Value ?? [];
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, $"{settings.BaseUrl.TrimEnd('/')}/internal/validation-presets");
            request.Headers.Add("X-Internal-Api-Key", settings.InternalApiKey);
            using var response = await httpClient.SendAsync(request, ct);
            response.EnsureSuccessStatusCode();

            var body = await response.Content.ReadFromJsonAsync<CatalogResponse>(cancellationToken: ct);
            IReadOnlyList<FormatPreset> presets = (body?.Presets ?? [])
                .Select(p => new FormatPreset(p.Key, p.Label, p.Kind, p.Pattern, p.MinLength, p.MaxLength, p.MinValue, p.MaxValue, p.Message, p.TextMode))
                .ToList();

            cache.Set(CacheKey, presets, CacheFor);
            lastKnownGood.Set(presets);
            return presets;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            if (ct.IsCancellationRequested) throw;

            logger.LogWarning(ex, "Could not read the Manage Formats catalog from AuthService; using the last catalog read ({Count} formats).",
                lastKnownGood.Value?.Count ?? 0);
            return lastKnownGood.Value ?? [];
        }
    }
}
