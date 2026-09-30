using System.Net;
using System.Text;
using System.Text.Json;
using LeadManagement.Api.Infrastructure;
using LeadManagement.Api.Options;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using MsOptions = Microsoft.Extensions.Options.Options;

namespace LeadService.Tests;

/// <summary>
/// A stand-in for ProductsService's internal catalogue endpoints, driven through the real
/// <see cref="ProductCatalogClient"/> so the tests cover the client's own behaviour too.
/// </summary>
internal sealed class FakeMarketplace
{
    public static readonly Guid LoansId = Guid.Parse("a1000000-0000-0000-0000-000000000001");
    public static readonly Guid HomeLoanId = Guid.Parse("a2000000-0000-0000-0000-000000000001");
    public static readonly Guid CardsId = Guid.Parse("a1000000-0000-0000-0000-000000000002");
    public static readonly Guid CashbackId = Guid.Parse("a2000000-0000-0000-0000-000000000002");

    public static readonly CatalogProduct HomeLoanSalaried = new(
        Guid.Parse("a3000000-0000-0000-0000-000000000001"), "Home Loan – Salaried", "HL_001", "For salaried applicants", "home",
        HomeLoanId, "Home Loan", "LN-HM", LoansId, "Loans", "LN");

    public static readonly CatalogProduct CashbackCard = new(
        Guid.Parse("a3000000-0000-0000-0000-000000000002"), "Cashback Card", "CC_001", "1.5% back", "card",
        CashbackId, "Cashback", "CC-CB", CardsId, "Credit Cards", "CC");

    /// <summary>What the Marketplace currently offers. Removing an entry is the same as switching its category off.</summary>
    public List<CatalogProduct> Offered { get; } = [HomeLoanSalaried, CashbackCard];

    /// <summary>When true every request fails as if the service were unreachable.</summary>
    public bool Down { get; set; }

    public int Calls { get; private set; }
    public string? LastKey { get; private set; }

    private readonly ProductCatalogClient.LastKnownGood lastKnownGood = new();

    public ProductCatalogClient Client() => new(
        new HttpClient(new Handler(this)),
        MsOptions.Create(new ProductsIntegrationOptions { BaseUrl = "http://products.test", InternalApiKey = "products-key" }),
        // A new cache per client: the tests that care about caching hold one client and reuse it.
        new MemoryCache(new MemoryCacheOptions()), lastKnownGood, NullLogger<ProductCatalogClient>.Instance);

    private HttpResponseMessage Respond(HttpRequestMessage request)
    {
        Calls++;
        LastKey = request.Headers.TryGetValues("X-Internal-Api-Key", out var values) ? values.FirstOrDefault() : null;
        if (Down) throw new HttpRequestException("down");

        var path = request.RequestUri!.AbsolutePath.TrimEnd('/');
        const string root = "/internal/catalog";

        if (path == $"{root}/categories")
        {
            return Json(Offered.GroupBy(p => (p.CategoryId, p.CategoryName, p.CategoryCode))
                .Select(g => new CatalogCategory(g.Key.CategoryId, g.Key.CategoryName, g.Key.CategoryCode, "", g.Count())));
        }

        if (path == $"{root}/sub-categories")
        {
            return Json(Offered.GroupBy(p => (p.SubCategoryId, p.SubCategoryName, p.SubCategoryCode, p.CategoryId, p.CategoryName, p.CategoryCode))
                .Select(g => new CatalogSubCategory(g.Key.SubCategoryId, g.Key.SubCategoryName, g.Key.SubCategoryCode, g.Key.CategoryId, g.Key.CategoryName, g.Key.CategoryCode)));
        }

        if (path.StartsWith($"{root}/categories/", StringComparison.Ordinal) && path.EndsWith("/products", StringComparison.Ordinal))
        {
            var categoryId = Guid.Parse(path[$"{root}/categories/".Length..^"/products".Length]);
            return Json(Offered.Where(p => p.CategoryId == categoryId));
        }

        if (path.StartsWith($"{root}/products/", StringComparison.Ordinal))
        {
            var id = Guid.Parse(path[$"{root}/products/".Length..]);
            var product = Offered.FirstOrDefault(p => p.Id == id);
            return product is null ? new HttpResponseMessage(HttpStatusCode.NotFound) : Json(product);
        }

        return new HttpResponseMessage(HttpStatusCode.NotFound);
    }

    private static HttpResponseMessage Json(object value) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(JsonSerializer.Serialize(value, new JsonSerializerOptions(JsonSerializerDefaults.Web)), Encoding.UTF8, "application/json"),
    };

    private sealed class Handler(FakeMarketplace owner) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(owner.Respond(request));
    }
}
