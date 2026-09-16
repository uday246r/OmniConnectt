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
using ProductMarketplace.Application.Interfaces;
using ProductMarketplace.Infrastructure.Data;
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
