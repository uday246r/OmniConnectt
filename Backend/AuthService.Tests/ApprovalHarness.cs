using System.Net;
using System.Security.Cryptography;
using AuthService.Application.Services;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Caching;
using AuthService.Infrastructure.Remotes;
using AuthService.Infrastructure.Security;
using AuthService.Infrastructure.Validation;
using AuthService.Options;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using MsOptions = Microsoft.Extensions.Options.Options;

namespace AuthService.Tests;

/// <summary>
/// The whole approval graph, assembled for a test.
/// </summary>
/// <remarks>
/// <para>
/// <see cref="ApprovalAppService"/> takes six collaborators, and every one of them matters to how a
/// replay behaves — the replay runs through the SAME validated User/Role/RemoteApp methods a direct
/// call would use, which is precisely the property worth testing and the reason none of them can be
/// stubbed away. Building the graph by hand in each test file would be several dozen lines of setup
/// repeated three times, and the repetition is where the copies drift.
/// </para>
/// <para>
/// Only two things are faked, both because they leave the process: the outbound replay HTTP call and
/// the mail sender. Everything else is the real implementation over an in-memory database.
/// </para>
/// </remarks>
internal sealed class ApprovalHarness : IDisposable
{
    private readonly MemoryCache memory = new(new MemoryCacheOptions());
    private readonly HttpContextAccessor accessor;

    public AuthDbContext Db { get; }
    public RecordingPublisher Events { get; }
    public AuditLogAppService AuditLog { get; }
    public ApprovalGatingService Gating { get; }
    public ApprovalAppService Approvals { get; }
    public UserAppService Users { get; }
    public RoleAppService Roles { get; }
    public RecordingCallbackHandler RemoteCallbacks { get; }
    public RecordingEmailSender Emails { get; }
    public SetPasswordInviteService Invites { get; }

    /// <param name="db">
    /// Pass an explicit context to point two harnesses at one database — how the two-actor tests
    /// reproduce two application instances racing the same row.
    /// </param>
    public ApprovalHarness(AuthDbContext? db = null)
    {
        Db = db ?? TestDb.Create("approval-harness");
        Events = new RecordingPublisher();

        var cache = new MemoryPlatformCache(memory);
        accessor = new HttpContextAccessor();
        AuditLog = new AuditLogAppService(Db, Events, accessor);
        Gating = new ApprovalGatingService(Db, AuditLog, Events);

        var fine = new FineCapabilityService(Db, cache);
        var catalog = new PermissionCatalogAppService(Db, cache, fine);
        var hasher = new PasswordHasher();

        Emails = new RecordingEmailSender();
        Invites = new SetPasswordInviteService(
            Db, Emails, hasher,
            MsOptions.Create(new SmtpOptions()), MsOptions.Create(new PasswordPolicyOptions()),
            AuditLog, NullLogger<SetPasswordInviteService>.Instance);
        var invites = Invites;

        var fieldSchema = new UserFieldSchemaAppService(Db, AuditLog);
        var validationPresets = new ValidationPresetAppService(Db, AuditLog);
        var salutations = new SalutationAppService(Db, AuditLog);

        Users = new UserAppService(
            Db, hasher, AuditLog, accessor, Gating, invites, fine,
            fieldSchema, new UserSchemaValidator(), validationPresets, salutations);

        Roles = new RoleAppService(Db, AuditLog, accessor, Gating, fine);

        var remoteApps = new RemoteAppAppService(
            Db, catalog,
            new RemoteCapabilityDiscoveryClient(new HttpClient(new UnreachableHandler()), NullLogger<RemoteCapabilityDiscoveryClient>.Instance),
            new RemoteManifestClient(new HttpClient(new UnreachableHandler()), NullLogger<RemoteManifestClient>.Instance),
            Gating, AuditLog, NullLogger<RemoteAppAppService>.Instance);

        RemoteCallbacks = new RecordingCallbackHandler();
        var callbackClient = new RemoteApprovalCallbackClient(
            new HttpClient(RemoteCallbacks), MsOptions.Create(new InternalApiOptions { ApiKey = "test-key" }));

        Approvals = new ApprovalAppService(
            Db, AuditLog, Users, Roles, remoteApps, callbackClient, Events);
    }

    public void Dispose()
    {
        Db.Dispose();
        memory.Dispose();
    }

    /// <summary>
    /// Starts a fresh simulated HTTP request, with its own trace identifier.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Correlation ids are per-request by construction: <c>ResolveCorrelationId</c> caches on
    /// <c>HttpContext.Items</c> so every write within one request agrees, and falls back to a new
    /// GUID when there is no context at all. A test that never installs a context therefore gets a
    /// different id for every single row, and a test that installs ONE gets the same id for every
    /// row — either way the correlation behaviour is invisible, and the second is worse because it
    /// would pass whether or not the mechanism worked.
    /// </para>
    /// <para>
    /// Calling this between the submit and the decision reproduces what actually happens: two
    /// separate HTTP requests, minutes or days apart, whose audit rows have to end up on one thread
    /// anyway. That is what <c>SeedCorrelationId</c> exists to achieve, and this is the only way to
    /// observe it.
    /// </para>
    /// </remarks>
    public void BeginRequest() => accessor.HttpContext = new DefaultHttpContext
    {
        TraceIdentifier = Guid.NewGuid().ToString(),
    };

    // ── Fixtures ─────────────────────────────────────────────────────────────

    public async Task<Role> AddRoleAsync(string name, bool isAdministrator = false)
    {
        var role = new Role
        {
            Id = Guid.NewGuid(),
            Name = name,
            IsAdministrator = isAdministrator,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        Db.Roles.Add(role);
        await Db.SaveChangesAsync();
        return role;
    }

    public async Task<User> AddUserAsync(
        string name, UserStatus status = UserStatus.Active, Role? role = null, string? email = null)
    {
        var user = new User
        {
            Id = Guid.NewGuid(),
            Name = name,
            Email = email ?? $"{name.Replace(" ", "").ToLowerInvariant()}@example.com",
            Status = status,
            RoleId = role?.Id,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        Db.Users.Add(user);
        await Db.SaveChangesAsync();
        return user;
    }

    /// <summary>Makes <paramref name="module"/> gated, with <paramref name="checker"/> to decide it.</summary>
    public async Task GateAsync(string module, User checker)
    {
        Db.CheckerAssignments.Add(new CheckerAssignment
        {
            Id = Guid.NewGuid(),
            Module = module,
            CheckerUserId = checker.Id,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await Db.SaveChangesAsync();
    }

    /// <summary>
    /// A feature and one capability, which grants and overrides must reference to be accepted.
    /// </summary>
    public async Task<PermissionFeature> AddFeatureAsync(string key, params string[] capabilities)
    {
        var feature = new PermissionFeature
        {
            Id = Guid.NewGuid(),
            Key = key,
            DisplayName = key,
            Source = PermissionFeatureSource.Host,
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        Db.PermissionFeatures.Add(feature);

        foreach (var capability in capabilities)
        {
            Db.PermissionFeatureCapabilities.Add(new PermissionFeatureCapability
            {
                Id = Guid.NewGuid(),
                FeatureId = feature.Id,
                Key = capability,
                DisplayName = capability,
                IsActive = true,
            });
        }

        await Db.SaveChangesAsync();
        return feature;
    }

    // ── Fakes for the two collaborators that leave the process ───────────────

    /// <summary>
    /// Stands in for the remote service a generic replay POSTs to. Records every call so a test can
    /// assert not just that the replay happened but how MANY times — which is the whole point of the
    /// retry guard around it.
    /// </summary>
    internal sealed class RecordingCallbackHandler : HttpMessageHandler
    {
        public List<string> Calls { get; } = [];

        /// <summary>Set to make the remote refuse, which must leave the request Pending.</summary>
        public HttpStatusCode ResponseStatus { get; set; } = HttpStatusCode.NoContent;

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Calls.Add(request.RequestUri!.ToString());
            return Task.FromResult(new HttpResponseMessage(ResponseStatus)
            {
                Content = new StringContent(ResponseStatus == HttpStatusCode.NoContent ? "" : "the remote refused"),
            });
        }
    }

    private sealed class UnreachableHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            throw new HttpRequestException("Connection refused");
    }

    /// <summary>
    /// A working mail server that delivers nowhere. Enabled matters: a set-password invite is the
    /// only thing that makes a newly created account usable, so a harness reporting mail as disabled
    /// would exercise the one path where provisioning silently produces an account nobody can sign
    /// into — the opposite of what these tests are about.
    /// </summary>
    public sealed class RecordingEmailSender : AuthService.Infrastructure.Email.IEmailSender
    {
        public List<(string To, string Subject)> Sent { get; } = [];

        public bool IsEnabled { get; set; } = true;

        public Task<bool> SendAsync(string toEmail, string toName, string subject, string html, string text, CancellationToken ct = default)
        {
            if (!IsEnabled) return Task.FromResult(false);
            Sent.Add((toEmail, subject));
            return Task.FromResult(true);
        }
    }
}
