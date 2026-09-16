using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Domain.Entities;
using ProductMarketplace.Infrastructure.Data;
using ProductMarketplace.Infrastructure.Services;
using Xunit;
using DomainApplication = ProductMarketplace.Domain.Entities.Application;

namespace ProductsService.Tests;

/// <summary>
/// The status cards above the Applications and Promotions lists, counted by the database.
/// </summary>
/// <remarks>
/// Those cards counted the rows of the page on screen, so with more records than one page holds they
/// under-reported and changed as you paged. The server now counts per status over the whole filtered
/// set; these tests hold it to that, and to leaving the status filter out (a card per status is
/// pointless if choosing one status zeroes every other card). The paging tests guard the lighter list
/// query that replaced loading every application's documents and history for a table row.
/// </remarks>
public class StatusCountTests : IDisposable
{
    private readonly AppDbContext db = TestDb.Create();

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public async Task Application_counts_cover_every_application_not_one_page()
    {
        var product = await ProductAsync("Home Loan");
        await ApplicationsAsync(product, "Submitted", 14);
        await ApplicationsAsync(product, "Approved", 9);

        var counts = await Applications().StatusCountsAsync(new ApplicationQueryDto { PageSize = 10 });

        Assert.Equal([new StatusCountDto("Approved", 9), new StatusCountDto("Submitted", 14)], counts);
    }

    [Fact]
    public async Task Application_counts_follow_the_search_but_ignore_the_status_filter()
    {
        var home = await ProductAsync("Home Loan");
        var car = await ProductAsync("Car Loan");
        await ApplicationsAsync(home, "Submitted", 3);
        await ApplicationsAsync(car, "Submitted", 5);
        await ApplicationsAsync(car, "Rejected", 2);

        var counts = await Applications().StatusCountsAsync(new ApplicationQueryDto { Search = "car", Status = "Rejected" });

        Assert.Equal([new StatusCountDto("Rejected", 2), new StatusCountDto("Submitted", 5)], counts);
    }

    [Fact]
    public async Task The_application_list_pages_through_every_application_once_with_its_product()
    {
        var product = await ProductAsync("Home Loan");
        await ApplicationsAsync(product, "Submitted", 25, sameInstant: true);

        var seen = new List<ApplicationListItemDto>();
        for (var page = 1; page <= 3; page++)
        {
            var result = await Applications().SearchAsync(new ApplicationQueryDto { Page = page, PageSize = 10 });
            Assert.Equal(25, result.TotalCount);
            seen.AddRange(result.Items);
        }

        Assert.Equal(25, seen.Select(a => a.Id).Distinct().Count());
        Assert.All(seen, a => Assert.Equal("Home Loan", a.ProductName));
        Assert.All(seen, a => Assert.Equal("Loans", a.CategoryName));
    }

    [Fact]
    public async Task Promotion_counts_and_paging_cover_every_promotion_even_with_equal_priority_and_time()
    {
        var product = await ProductAsync("Home Loan");
        var created = DateTime.UtcNow;
        for (var i = 0; i < 12; i++)
        {
            db.Promotions.Add(new Promotion { Title = $"Offer {i}", ProductId = product.Id, Status = i < 7 ? "Active" : "Draft", Priority = 1, CreatedAt = created });
        }
        await db.SaveChangesAsync();
        var service = new PromotionService(db, Audit());

        var counts = await service.StatusCountsAsync(new PromotionQueryDto());
        var seen = new List<Guid>();
        for (var page = 1; page <= 3; page++)
        {
            seen.AddRange((await service.SearchAsync(new PromotionQueryDto { Page = page, PageSize = 5 })).Items.Select(p => p.Id));
        }

        Assert.Equal([new StatusCountDto("Active", 7), new StatusCountDto("Draft", 5)], counts);
        Assert.Equal(12, seen.Distinct().Count());
    }

    // ---------------------------------------------------------------- fixture

    private AuditLogService Audit() => new(db, new FixedAuditContext(), new RecordingHub(), new RecordingForwarder());

    private ApplicationService Applications() => new(db, Audit(), new NoStorage());

    private async Task<Product> ProductAsync(string name)
    {
        var category = db.Categories.Local.FirstOrDefault() ?? new Category { Name = "Loans", Slug = "loans", Status = "Active" };
        var type = db.ProductTypes.Local.FirstOrDefault() ?? new ProductType { Name = "Loan", Code = "loan" };
        var product = new Product { Name = name, Code = name.Replace(" ", "").ToUpperInvariant(), CategoryId = category.Id, ProductTypeId = type.Id, Status = "Active" };
        if (db.Entry(category).State == Microsoft.EntityFrameworkCore.EntityState.Detached) db.Add(category);
        if (db.Entry(type).State == Microsoft.EntityFrameworkCore.EntityState.Detached) db.Add(type);
        db.Add(product);
        await db.SaveChangesAsync();
        return product;
    }

    private async Task ApplicationsAsync(Product product, string status, int count, bool sameInstant = false)
    {
        var now = DateTime.UtcNow;
        var start = db.Applications.Count();
        for (var i = 0; i < count; i++)
        {
            db.Applications.Add(new DomainApplication
            {
                ApplicationNumber = $"APP-{start + i}",
                ProductId = product.Id,
                CustomerName = $"Customer {start + i}",
                Status = status,
                CreatedAt = sameInstant ? now : now.AddMinutes(-(start + i)),
            });
        }
        await db.SaveChangesAsync();
    }

    private sealed class NoStorage : ProductMarketplace.Application.Interfaces.IFileStorageService
    {
        public Task<string> SaveAsync(Guid applicationId, Guid documentId, string originalFileName, Stream content, CancellationToken ct = default) => Task.FromResult("none");
        public Task<Stream?> OpenReadAsync(string storagePath, CancellationToken ct = default) => Task.FromResult<Stream?>(null);
        public void Delete(string storagePath) { }
    }
}
