using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ProductMarketplace.Api.Infrastructure;
using ProductMarketplace.Api.Infrastructure.Approvals;
using ProductMarketplace.Api.Options;
using ProductMarketplace.Api.Services;
using ProductMarketplace.Application.Common;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;
using ProductMarketplace.Domain.Entities;
using ProductMarketplace.Infrastructure.Data;
using ProductMarketplace.Infrastructure.Realtime;
using ProductMarketplace.Infrastructure.Services;
using Xunit;
using MsOptions = Microsoft.Extensions.Options.Options;

namespace ProductsService.Tests;

/// <summary>
/// Maker-checker and auditing for Products & Marketplace, as the platform defines them.
/// </summary>
/// <remarks>
/// Before integration nothing here went through approval and nothing reached the platform's audit trail;
/// the local trail named whoever the browser said. These pin: who the actor is, when a change waits for
/// a checker, that every approvable change can be replayed, and what leaves for the central trail.
/// </remarks>
public class ApprovalAndAuditTests : IDisposable
{
    private readonly AppDbContext db = TestDb.Create();

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    // ---------------------------------------------------------------- actor

    [Fact]
    public void The_actor_comes_from_the_token_and_browser_headers_are_ignored()
    {
        var id = Guid.NewGuid();
        var http = new DefaultHttpContext { User = Tokens.User(id, "Asha Rao") };
        http.Request.Headers["X-Actor-Name"] = "Someone Else";
        http.Request.Headers["X-Actor-Email"] = "forged@example.com";

        var context = new HttpAuditContext(new HttpContextAccessor { HttpContext = http }, new AuditActorOverride());

        Assert.Equal(id, context.UserId);
        Assert.Equal("Asha Rao", context.ActorName);
        Assert.Equal("asha@example.com", context.ActorEmail);
    }

    [Fact]
    public void Without_a_token_the_actor_is_System_whatever_the_headers_say()
    {
        var http = new DefaultHttpContext();
        http.Request.Headers["X-Actor-Name"] = "Super Admin";

        var context = new HttpAuditContext(new HttpContextAccessor { HttpContext = http }, new AuditActorOverride());

        Assert.Null(context.UserId);
        Assert.Equal("System", context.ActorName);
    }

    [Fact]
    public void During_a_replay_the_maker_is_the_actor()
    {
        var maker = Guid.NewGuid();
        var actorOverride = new AuditActorOverride();
        actorOverride.AttributeTo(maker, "Maker Name");

        var context = new HttpAuditContext(new HttpContextAccessor { HttpContext = new DefaultHttpContext() }, actorOverride);

        Assert.Equal(maker, context.UserId);
        Assert.Equal("Maker Name", context.ActorName);
    }

    // ---------------------------------------------------------------- gate

    private static (ApprovalGate Gate, FakeAuthService Auth) Gate(System.Security.Claims.ClaimsPrincipal user, bool gated, AuditActorOverride? actorOverride = null)
    {
        var auth = new FakeAuthService { Gated = gated };
        var http = new DefaultHttpContext { User = user };
        var gate = new ApprovalGate(auth.Client(http), MsOptions.Create(new SelfOptions { AppKey = "products", PublicBaseUrl = "http://products.test" }),
            new HttpContextAccessor { HttpContext = http }, actorOverride ?? new AuditActorOverride());
        return (gate, auth);
    }

    [Fact]
    public async Task An_ungated_change_applies_immediately()
    {
        var (gate, _) = Gate(Tokens.User(), gated: false);

        Assert.Null(await gate.TrySubmitAsync(ProductsMutations.ProductCreate, null, "Gold Card", new { name = "Gold Card" }, CancellationToken.None));
    }

    [Fact]
    public async Task A_gated_change_is_filed_under_the_platform_module_key_and_waits()
    {
        var maker = Guid.NewGuid();
        var (gate, auth) = Gate(Tokens.User(maker), gated: true);

        var pending = await gate.TrySubmitAsync(ProductsMutations.ProductStatus, "5f4c0a18-0000-0000-0000-000000000001", "Gold Card",
            new ProductStatusUpdateDto { Status = "Inactive" }, CancellationToken.None, before: new { status = "Active" });

        Assert.NotNull(pending);
        Assert.Contains(auth.Calls, c => c.Path == "/internal/approvals/gated/remote.products.products");

        var submit = auth.Calls.Single(c => c.Path == "/internal/approvals/submit");
        Assert.Equal("products-key", submit.Key);
        using var body = JsonDocument.Parse(submit.Body!);
        Assert.Equal("remote.products.products", body.RootElement.GetProperty("module").GetString());
        Assert.Equal("Update", body.RootElement.GetProperty("action").GetString());
        Assert.Equal(maker, body.RootElement.GetProperty("makerId").GetGuid());
        Assert.Equal("ProductsService", body.RootElement.GetProperty("sourceService").GetString());
        Assert.Equal("http://products.test/internal/approvals/apply", body.RootElement.GetProperty("callbackUrl").GetString());

        var envelope = JsonSerializer.Deserialize<ApprovalGate.Envelope>(body.RootElement.GetProperty("newDataJson").GetString()!, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        Assert.Equal("product.status", envelope.Operation);
        Assert.Contains("\"status\":\"Active\"", body.RootElement.GetProperty("oldDataJson").GetString());
    }

    [Fact]
    public async Task Administrators_changes_are_not_gated()
    {
        var (gate, auth) = Gate(Tokens.User(administrator: true), gated: true);

        Assert.Null(await gate.TrySubmitAsync(ProductsMutations.CategoryDelete, Guid.NewGuid().ToString(), "Loans", null, CancellationToken.None));
        Assert.Empty(auth.Calls);
    }

    [Fact]
    public async Task A_replay_is_never_gated_again()
    {
        var actorOverride = new AuditActorOverride();
        actorOverride.AttributeTo(Guid.NewGuid(), "Maker");
        var (gate, auth) = Gate(Tokens.Anonymous(), gated: true, actorOverride);

        Assert.Null(await gate.TrySubmitAsync(ProductsMutations.ProductCreate, null, "Gold Card", new { }, CancellationToken.None));
        Assert.Empty(auth.Calls);
    }

    [Fact]
    public async Task When_approval_cannot_be_checked_the_change_is_refused_not_applied()
    {
        var http = new DefaultHttpContext { User = Tokens.User() };
        var client = new AuthServiceClient(new HttpClient(new Unreachable()),
            MsOptions.Create(new AuthIntegrationOptions { BaseUrl = "http://auth.test", InternalApiKey = "k" }),
            MsOptions.Create(new SelfOptions { PublicBaseUrl = "http://p" }), new HttpContextAccessor { HttpContext = http },
            Microsoft.Extensions.Logging.Abstractions.NullLogger<AuthServiceClient>.Instance);
        var gate = new ApprovalGate(client, MsOptions.Create(new SelfOptions()), new HttpContextAccessor { HttpContext = http }, new AuditActorOverride());

        await Assert.ThrowsAsync<ApprovalServiceUnavailableException>(() =>
            gate.TrySubmitAsync(ProductsMutations.ProductCreate, null, "Gold Card", new { }, CancellationToken.None));
    }

    [Fact]
    public async Task A_record_that_already_has_a_pending_change_is_reported_as_a_conflict()
    {
        var (gate, auth) = Gate(Tokens.User(), gated: true);
        auth.SubmitStatus = HttpStatusCode.Conflict;

        await Assert.ThrowsAsync<ApprovalConflictException>(() =>
            gate.TrySubmitAsync(ProductsMutations.ProductDelete, Guid.NewGuid().ToString(), "Gold Card", null, CancellationToken.None));
    }

    // ---------------------------------------------------------------- replay

    public static IEnumerable<object[]> Mutations() => ProductsMutations.All.Select(m => new object[] { m.Operation });

    /// <summary>An approvable change with no replay handler would be approved and then silently do nothing.</summary>
    [Theory]
    [MemberData(nameof(Mutations))]
    public async Task Every_approvable_change_has_a_replay_handler(string operation)
    {
        using var services = Services();
        var entityId = operation.StartsWith("field.") && operation != "field.create" ? $"{Guid.NewGuid()}/{Guid.NewGuid()}" : Guid.NewGuid().ToString();

        var error = await Record.ExceptionAsync(() =>
            ProductsMutations.ApplyAsync(services, operation, entityId, JsonSerializer.SerializeToElement(new { }), CancellationToken.None));

        Assert.False(error is InvalidOperationException && error.Message.Contains("does not know how"), $"No replay handler for {operation}.");
    }

    [Fact]
    public async Task An_approved_create_is_applied_through_the_normal_service_and_attributed_to_the_maker()
    {
        var forwarder = new RecordingForwarder();
        var maker = Guid.NewGuid();
        using var services = Services(forwarder, new FixedAuditContext(maker, "Maker Name"));
        await new Catalogue(db).SeedStatusesAsync();

        await ProductsMutations.ApplyAsync(services, "category.create", null,
            JsonSerializer.SerializeToElement(new CategoryCreateUpdateDto { Name = "Home Loans", Code = "HL", Status = "Active" }, new JsonSerializerOptions(JsonSerializerDefaults.Web)),
            CancellationToken.None);

        Assert.Single(await db.Categories.Where(c => c.Name == "Home Loans").ToListAsync());
        var audit = await db.AuditLogs.SingleAsync(a => a.Action == AuditActions.CreateCategory);
        Assert.Equal(maker, audit.ActorUserId);
        Assert.Equal("Maker Name", audit.ActorName);
        Assert.Contains(forwarder.Entries, e => e.Action == AuditActions.CreateCategory && e.ActorUserId == maker);
    }

    [Fact]
    public async Task An_approved_change_to_a_record_that_no_longer_exists_fails_instead_of_passing_silently()
    {
        using var services = Services();

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => ProductsMutations.ApplyAsync(services, "product.status",
            Guid.NewGuid().ToString(), JsonSerializer.SerializeToElement(new { status = "Active" }), CancellationToken.None));

        Assert.Contains("no longer exists", error.Message);
    }

    // ---------------------------------------------------------------- audit

    [Fact]
    public async Task A_local_audit_entry_carries_the_user_id_and_is_forwarded_centrally()
    {
        var forwarder = new RecordingForwarder();
        var hub = new RecordingHub();
        var user = Guid.NewGuid();
        var service = new AuditLogService(db, new FixedAuditContext(user, "Asha Rao"), hub, forwarder);

        await service.LogAsync(AuditActions.UpdateProduct, AuditEntityTypes.Product, Guid.NewGuid(), "Gold Card", "Updated product \"Gold Card\"");

        var row = await db.AuditLogs.SingleAsync();
        Assert.Equal(user, row.ActorUserId);
        Assert.Single(forwarder.Entries);
        Assert.Equal("Asha Rao", forwarder.Entries[0].ActorName);
    }

    /// <summary>The live feed used to go to every open socket, signed in or not.</summary>
    [Fact]
    public async Task The_live_feed_goes_only_to_audit_viewers()
    {
        var hub = new RecordingHub();
        var service = new AuditLogService(db, new FixedAuditContext(), hub, new RecordingForwarder());

        await service.LogAsync(AuditActions.CreateProduct, AuditEntityTypes.Product, null, "x", "y");

        Assert.Equal(["group:" + AuditLogHub.ViewersGroup], hub.Recorded.Targets);
    }

    [Theory]
    [InlineData("product.create", "products.product.create", "CRUD")]
    [InlineData("product.view", "products.product.view", "ViewDetails")]
    [InlineData("status_config.update", "products.status_config.update", "Configuration")]
    [InlineData("audit_log.export", "products.audit_log.export", "Export")]
    public void Central_rows_use_the_platform_vocabulary(string local, string central, string category)
    {
        Assert.Equal(central, CentralAuditForwarder.CentralActionKey("products", local));
        Assert.Equal(category, CentralAuditForwarder.CategoryFor(local));
    }

    [Fact]
    public async Task Customer_searches_stay_in_this_apps_analytics_and_are_not_forwarded()
    {
        var auth = new FakeAuthService();
        var forwarder = new CentralAuditForwarder(auth.Client(), MsOptions.Create(new SelfOptions { AppKey = "products" }));

        await forwarder.ForwardAsync(new AuditForwardEntry(AuditActions.Search, AuditEntityTypes.Search, null, "home loan", "Searched", true, null, "x"));
        await forwarder.ForwardAsync(new AuditForwardEntry(AuditActions.DeleteProduct, AuditEntityTypes.Product, Guid.NewGuid(), "Gold", "Deleted", true, Guid.NewGuid(), "Asha"));

        var pushed = Assert.Single(auth.Calls);
        Assert.Equal("/internal/audit-logs", pushed.Path);
        using var body = JsonDocument.Parse(pushed.Body!);
        Assert.Equal("products.product.delete", body.RootElement.GetProperty("action").GetString());
        Assert.Equal("Products & Marketplace", body.RootElement.GetProperty("sourceApplication").GetString());
        Assert.Equal("ProductsService", body.RootElement.GetProperty("serviceName").GetString());
    }

    [Fact]
    public async Task The_audit_export_matches_the_list_filters_and_reports_its_counts()
    {
        var service = new AuditLogService(db, new FixedAuditContext(), new RecordingHub(), new RecordingForwarder());
        await service.LogAsync(AuditActions.CreateProduct, AuditEntityTypes.Product, null, "Gold Card", "Created product \"Gold Card\"");
        await service.LogAsync(AuditActions.DeleteCategory, AuditEntityTypes.Category, null, "Loans", "Deleted category \"Loans\"");

        var query = new AuditLogQueryDto { EntityType = AuditEntityTypes.Product };
        var list = await service.SearchAsync(query);
        var export = await service.ExportCsvAsync(query);

        Assert.Equal(list.TotalCount, export.MatchCount);
        Assert.Contains("Gold Card", export.Content);
        Assert.DoesNotContain("Loans", export.Content);
        Assert.StartsWith("Time (UTC),Performed by", export.Content);
    }

    private ServiceProvider Services(IAuditForwarder? forwarder = null, IAuditContext? audit = null)
    {
        var services = new ServiceCollection();
        services.AddSingleton(db);
        services.AddSingleton<IAuditContext>(audit ?? new FixedAuditContext());
        services.AddSingleton(forwarder ?? new RecordingForwarder());
        services.AddSingleton<Microsoft.AspNetCore.SignalR.IHubContext<AuditLogHub>>(new RecordingHub());
        services.AddScoped<IAuditLogService, AuditLogService>();
        services.AddScoped<ICatalogStatuses, CatalogStatuses>();
        services.AddSingleton<IFormatPresetSource>(new NoPresets());
        services.AddScoped<ICategoryService, CategoryService>();
        services.AddScoped<ISubCategoryService, SubCategoryService>();
        services.AddScoped<IProductService, ProductService>();
        services.AddScoped<IDocumentDefinitionService, DocumentDefinitionService>();
        services.AddScoped<IStatusConfigService, StatusConfigService>();
        return services.BuildServiceProvider();
    }

    private sealed class Unreachable : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            throw new HttpRequestException("Connection refused");
    }
}
