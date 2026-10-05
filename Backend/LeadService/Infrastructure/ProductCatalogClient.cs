using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using LeadManagement.Api.Options;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace LeadManagement.Api.Infrastructure;

/// <summary>A product as the Marketplace publishes it — enough to offer, to pick, and to snapshot onto a lead.</summary>
public sealed record CatalogProduct(
    Guid Id, string Name, string Code, string ShortDescription, string IconKey,
    Guid SubCategoryId, string SubCategoryName, string SubCategoryCode,
    Guid CategoryId, string CategoryName, string CategoryCode);

public sealed record CatalogCategory(Guid Id, string Name, string Code, string IconKey, int ProductCount);

public sealed record CatalogSubCategory(Guid Id, string Name, string Code, Guid CategoryId, string CategoryName, string CategoryCode);

/// <summary>
/// The Marketplace could not be asked. Answered as 503 like an unverifiable approval gate: a lead must not
/// be filed against a product nobody could confirm is still offered.
/// </summary>
public class CatalogUnavailableException(string message) : ApprovalServiceUnavailableException(message);

/// <summary>
/// Lead Management's only view of the product catalogue: ProductsService's internal lookup endpoints,
/// called server to server so a lead user needs no permission in the Marketplace.
/// </summary>
/// <remarks>
/// <para>
/// What the Marketplace offers is decided there, not here: a product is returned only while it, its
/// sub-category and its category are all live in Setup. Nothing in this class or its callers knows what
/// "active" means.
/// </para>
/// <para>
/// <b>Two different failure modes, deliberately.</b> The <i>lists</i> that fill the pickers are cached for
/// <see cref="CacheFor"/> and fall back to the last list read when the Marketplace is unreachable — a
/// brief outage should not blank the lead form. <see cref="GetProductAsync"/>, which decides whether a
/// lead may be filed, is <b>never</b> cached and never falls back: it either confirms the product now, or
/// says it is gone (null), or throws <see cref="CatalogUnavailableException"/>.
/// </para>
/// </remarks>
public class ProductCatalogClient(
    HttpClient httpClient,
    IOptions<ProductsIntegrationOptions> options,
    IMemoryCache cache,
    ProductCatalogClient.LastKnownGood lastKnownGood,
    ILogger<ProductCatalogClient> logger)
{
    public static readonly TimeSpan CacheFor = TimeSpan.FromSeconds(30);

    /// <summary>Survives the scoped client; one per process.</summary>
    public sealed class LastKnownGood
    {
        private readonly ConcurrentDictionary<string, object> values = new();

        public T? Get<T>(string key) where T : class => values.TryGetValue(key, out var v) ? v as T : null;

        public void Set(string key, object value) => values[key] = value;
    }

    public Task<IReadOnlyList<CatalogCategory>> GetCategoriesAsync(CancellationToken ct = default) =>
        ListAsync<CatalogCategory>("categories", "internal/catalog/categories", ct);

    public Task<IReadOnlyList<CatalogSubCategory>> GetSubCategoriesAsync(CancellationToken ct = default) =>
        ListAsync<CatalogSubCategory>("sub-categories", "internal/catalog/sub-categories", ct);

    public Task<IReadOnlyList<CatalogProduct>> GetProductsAsync(Guid categoryId, CancellationToken ct = default) =>
        ListAsync<CatalogProduct>($"products:{categoryId}", $"internal/catalog/categories/{categoryId}/products", ct);

    /// <summary>The product as the Marketplace shows it right now; null if it does not exist or is no longer offered.</summary>
    public async Task<CatalogProduct?> GetProductAsync(Guid productId, CancellationToken ct = default)
    {
        try
        {
            using var request = Request($"internal/catalog/products/{productId}");
            using var response = await httpClient.SendAsync(request, ct);
            if (response.StatusCode == HttpStatusCode.NotFound) return null;
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<CatalogProduct>(cancellationToken: ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException or CatalogUnavailableException)
        {
            if (ct.IsCancellationRequested) throw;
            logger.LogWarning(ex, "Could not confirm product {ProductId} with the Marketplace.", productId);
            throw new CatalogUnavailableException("The product catalogue is not reachable right now, so the product could not be confirmed. Please try again in a moment.");
        }
    }

    private async Task<IReadOnlyList<T>> ListAsync<T>(string key, string path, CancellationToken ct) where T : class
    {
        var cacheKey = $"product-catalog:{key}";
        if (cache.TryGetValue(cacheKey, out IReadOnlyList<T>? cached) && cached is not null) return cached;

        try
        {
            using var request = Request(path);
            using var response = await httpClient.SendAsync(request, ct);
            response.EnsureSuccessStatusCode();
            IReadOnlyList<T> list = await response.Content.ReadFromJsonAsync<List<T>>(cancellationToken: ct) ?? [];

            cache.Set(cacheKey, list, CacheFor);
            lastKnownGood.Set(cacheKey, list);
            return list;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException or CatalogUnavailableException)
        {
            if (ct.IsCancellationRequested) throw;

            var previous = lastKnownGood.Get<IReadOnlyList<T>>(cacheKey);
            if (previous is null)
            {
                throw new CatalogUnavailableException("The product catalogue is not reachable right now. Please try again in a moment.");
            }

            logger.LogWarning(ex, "Could not read {Path} from the Marketplace; using the last list read ({Count} items).", path, previous.Count);
            return previous;
        }
    }

    private HttpRequestMessage Request(string path)
    {
        var settings = options.Value;
        if (string.IsNullOrWhiteSpace(settings.BaseUrl))
        {
            throw new CatalogUnavailableException("The product catalogue is not configured (ProductsService:BaseUrl).");
        }

        var request = new HttpRequestMessage(HttpMethod.Get, $"{settings.BaseUrl.TrimEnd('/')}/{path}");
        request.Headers.Add("X-Internal-Api-Key", settings.InternalApiKey);
        return request;
    }
}
