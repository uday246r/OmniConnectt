using System.Net;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using ProductMarketplace.Api.Infrastructure;
using ProductMarketplace.Api.Options;
using OmniConnect.Validation;
using ProductMarketplace.Application.Common;
using ProductMarketplace.Application.Interfaces;
using ProductMarketplace.Domain.Entities;
using ProductMarketplace.Infrastructure.Data;
using ProductMarketplace.Infrastructure.Services;
using ProductMarketplace.Infrastructure.Realtime;
using MsOptions = Microsoft.Extensions.Options.Options;

namespace ProductsService.Tests;

internal static class TestDb
{
    public static AppDbContext Create() => new(new DbContextOptionsBuilder<AppDbContext>()
        .UseInMemoryDatabase($"products-{Guid.NewGuid()}")
        .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
        .Options);
}

internal static class Tokens
{
    public static ClaimsPrincipal User(Guid? id = null, string name = "Asha Rao", bool administrator = false, params string[] permissions)
    {
        var claims = new List<Claim>
        {
            new("sub", (id ?? Guid.NewGuid()).ToString()),
            new("name", name),
            new("email", "asha@example.com"),
            new("perms", JsonSerializer.Serialize(permissions)),
        };
        if (administrator) claims.Add(new Claim("administrator", "true"));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, "Test"));
    }

    public static ClaimsPrincipal Anonymous() => new(new ClaimsIdentity());
}

/// <summary>A fixed actor for services under test.</summary>
internal sealed class FixedAuditContext(Guid? userId = null, string name = "Tester") : IAuditContext
{
    public Guid? UserId { get; } = userId;
    public string ActorName { get; } = name;
    public string ActorEmail => "tester@example.com";
    public string? IpAddress => "10.0.0.1";
    public string? UserAgent => null;
}

internal sealed class RecordingForwarder : IAuditForwarder
{
    public List<AuditForwardEntry> Entries { get; } = [];

    public Task ForwardAsync(AuditForwardEntry entry, CancellationToken ct = default)
    {
        Entries.Add(entry);
        return Task.CompletedTask;
    }
}

/// <summary>Records what the hub was asked to send, and to whom.</summary>
internal sealed class RecordingHub : IHubContext<AuditLogHub>
{
    public HubClients Recorded { get; } = new();
    public IHubClients Clients => Recorded;
    public IGroupManager Groups => throw new NotSupportedException();

    internal sealed class HubClients : IHubClients
    {
        public List<string> Targets { get; } = [];
        private ClientProxy Proxy(string target) { Targets.Add(target); return new ClientProxy(); }

        public IClientProxy All => Proxy("all");
        public IClientProxy AllExcept(IReadOnlyList<string> excludedConnectionIds) => Proxy("all-except");
        public IClientProxy Client(string connectionId) => Proxy($"client:{connectionId}");
        public IClientProxy Clients(IReadOnlyList<string> connectionIds) => Proxy("clients");
        public IClientProxy Group(string groupName) => Proxy($"group:{groupName}");
        public IClientProxy GroupExcept(string groupName, IReadOnlyList<string> excludedConnectionIds) => Proxy($"group-except:{groupName}");
        public IClientProxy Groups(IReadOnlyList<string> groupNames) => Proxy("groups");
        public IClientProxy User(string userId) => Proxy($"user:{userId}");
        public IClientProxy Users(IReadOnlyList<string> userIds) => Proxy("users");
    }

    internal sealed class ClientProxy : IClientProxy
    {
        public Task SendCoreAsync(string method, object?[] args, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}

/// <summary>Stands in for AuthService: records every call and answers from a script.</summary>
internal sealed class FakeAuthService : HttpMessageHandler
{
    public List<(HttpMethod Method, string Path, string? Body, string? Key)> Calls { get; } = [];
    public bool Gated { get; set; }
    public HttpStatusCode SubmitStatus { get; set; } = HttpStatusCode.OK;

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var body = request.Content is null ? null : await request.Content.ReadAsStringAsync(ct);
        var key = request.Headers.TryGetValues("X-Internal-Api-Key", out var values) ? values.FirstOrDefault() : null;
        var path = request.RequestUri!.AbsolutePath;
        Calls.Add((request.Method, path, body, key));

        if (path.Contains("/internal/approvals/gated/"))
        {
            return Json(new { gated = Gated });
        }

        if (path.EndsWith("/internal/approvals/submit"))
        {
            if (SubmitStatus != HttpStatusCode.OK)
            {
                return new HttpResponseMessage(SubmitStatus) { Content = new StringContent("{\"title\":\"already pending\",\"status\":409}") };
            }

            return Json(new { approvalRequestId = Guid.NewGuid(), module = "m", action = "Create", checkerName = "Ben Ito", message = "Request submitted for approval." });
        }

        return new HttpResponseMessage(HttpStatusCode.NoContent);
    }

    private static HttpResponseMessage Json(object value) =>
        new(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(value), System.Text.Encoding.UTF8, "application/json") };

    public AuthServiceClient Client(HttpContext? http = null, string appKey = "products") =>
        new(new HttpClient(this),
            MsOptions.Create(new AuthIntegrationOptions { BaseUrl = "http://auth.test", InternalApiKey = "products-key", ServiceName = "ProductsService" }),
            MsOptions.Create(new SelfOptions { PublicBaseUrl = "http://products.test", AppKey = appKey, DisplayName = "Products & Marketplace" }),
            new HttpContextAccessor { HttpContext = http ?? new DefaultHttpContext() },
            NullLogger<AuthServiceClient>.Instance);
}

/// <summary>No admin-defined formats: built-in rules still apply, and anything that names an unknown format fails open.</summary>
internal sealed class NoPresets : IFormatPresetSource
{
    public Task<IReadOnlyList<FormatPreset>> GetAsync(CancellationToken ct = default) => Task.FromResult<IReadOnlyList<FormatPreset>>([]);
}

/// <summary>A fixed set of admin-defined formats.</summary>
internal sealed class FixedPresets(params FormatPreset[] presets) : IFormatPresetSource
{
    public Task<IReadOnlyList<FormatPreset>> GetAsync(CancellationToken ct = default) => Task.FromResult<IReadOnlyList<FormatPreset>>(presets);
}

/// <summary>
/// The catalogue's services over one in-memory database, and the few rows every test needs.
/// </summary>
/// <remarks>
/// Each service is built fresh on access, with a fresh <see cref="CatalogStatuses"/>, the way a new
/// request would get them — so a test that changes Setup between two calls sees the change, as the
/// second request would.
/// </remarks>
internal sealed class Catalogue(AppDbContext db)
{
    public AppDbContext Db => db;
    public AuditLogService Audit => new(db, new FixedAuditContext(), new RecordingHub(), new RecordingForwarder());
    public CatalogStatuses Statuses => new(db);
    public CategoryService Categories => new(db, Audit, Statuses);
    public SubCategoryService SubCategories => new(db, Audit, Statuses);
    public DashboardService Dashboard => new(db, Statuses);
    public StatusConfigService StatusConfigs => new(db, Audit);
    public DocumentDefinitionService Documents => new(db, Audit);
    public ProductService Products(IFormatPresetSource? presets = null) => new(db, Audit, Statuses, presets ?? new NoPresets());

    /// <summary>
    /// The statuses the migration ships: products start as Draft; Active is the only live status for each
    /// type. Written out here rather than read from the migration so a test states what it relies on.
    /// </summary>
    public async Task SeedStatusesAsync()
    {
        db.StatusConfigs.AddRange(
            Status(StatusEntityTypes.Product, "Draft", live: false, order: 1),
            Status(StatusEntityTypes.Product, "Active", live: true, order: 2),
            Status(StatusEntityTypes.Product, "Inactive", live: false, order: 3),
            Status(StatusEntityTypes.SubCategory, "Active", live: true, order: 1),
            Status(StatusEntityTypes.SubCategory, "Inactive", live: false, order: 2),
            Status(StatusEntityTypes.Category, "Active", live: true, order: 1),
            Status(StatusEntityTypes.Category, "Inactive", live: false, order: 2));
        await db.SaveChangesAsync();
    }

    public static StatusConfig Status(string entityType, string value, bool live, int order) => new()
    {
        EntityType = entityType, Value = value, Label = value, Color = live ? "success" : "neutral", Enabled = true, IsLive = live, SortOrder = order,
    };

    public async Task<Category> AddCategoryAsync(string name = "Loans", string code = "LN", string status = "Active", int order = 1)
    {
        var category = new Category { Name = name, Code = code, Status = status, DisplayOrder = order };
        db.Categories.Add(category);
        await db.SaveChangesAsync();
        return category;
    }

    public async Task<SubCategory> AddSubCategoryAsync(Category category, string name = "Home Loan", string code = "LN-HM", string status = "Active", int order = 1)
    {
        var sub = new SubCategory { CategoryId = category.Id, Name = name, Code = code, Status = status, DisplayOrder = order };
        db.SubCategories.Add(sub);
        await db.SaveChangesAsync();
        return sub;
    }

    public async Task<Product> AddProductAsync(SubCategory sub, string name = "Home Loan – Salaried", string code = "HL_001", string status = "Active", DateTime? createdAt = null)
    {
        var product = new Product { SubCategoryId = sub.Id, Name = name, Code = code, Status = status, CreatedAt = createdAt ?? DateTime.UtcNow };
        db.Products.Add(product);
        await db.SaveChangesAsync();
        return product;
    }

    /// <summary>A category, a sub-category under it, and a product under that — all live.</summary>
    public async Task<(Category Category, SubCategory Sub, Product Product)> AddLiveChainAsync()
    {
        var category = await AddCategoryAsync();
        var sub = await AddSubCategoryAsync(category);
        return (category, sub, await AddProductAsync(sub));
    }
}
