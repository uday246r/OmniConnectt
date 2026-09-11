using System.Security.Claims;
using System.Security.Cryptography;
using System.Threading.RateLimiting;
using AuthService.Application.Events;
using AuthService.Application.Services;
using AuthService.Hubs;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Caching;
using AuthService.Infrastructure.Locking;
using AuthService.Infrastructure.Remotes;
using AuthService.Infrastructure.Email;
using AuthService.Infrastructure.Security;
using AuthService.Infrastructure.Seed;
using AuthService.Options;
using DotNetEnv;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using StackExchange.Redis;

foreach (var path in new[] {
    Path.Combine(AppContext.BaseDirectory, ".env"),
    Path.Combine(Directory.GetCurrentDirectory(), "Backend", "AuthService", ".env"),
    Path.Combine(Directory.GetCurrentDirectory(), ".env")
})
{
    if (File.Exists(path)) { Env.Load(path); break; }
}
Env.TraversePath().Load();

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers(options =>
{
    options.Filters.Add<AppExceptionFilter>();
    // Global, so every current and future AuthService endpoint is closed by default to a user who
    // has not yet replaced their temporary password. See MustChangePasswordFilter's own remarks.
    options.Filters.Add<MustChangePasswordFilter>();
});
builder.Services.AddOpenApi();
// Lets UserAppService/RoleAppService (in-process audit writers) read the real caller's IP/User-Agent
// off the current request without every mutation method threading HttpContext through as a param.
builder.Services.AddHttpContextAccessor();

builder.Services.Configure<CorsOptions>(builder.Configuration.GetSection(CorsOptions.SectionName));
builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection(JwtOptions.SectionName));
builder.Services.Configure<AuthCookieOptions>(builder.Configuration.GetSection(AuthCookieOptions.SectionName));
builder.Services.Configure<InternalApiOptions>(builder.Configuration.GetSection(InternalApiOptions.SectionName));
builder.Services.Configure<GoogleAuthOptions>(builder.Configuration.GetSection(GoogleAuthOptions.SectionName));
builder.Services.Configure<SecretProtectionOptions>(builder.Configuration.GetSection(SecretProtectionOptions.SectionName));
builder.Services.Configure<SmtpOptions>(builder.Configuration.GetSection(SmtpOptions.SectionName));

var connectionString = builder.Configuration.GetConnectionString("AuthDb");
var isDbConfigured = !string.IsNullOrWhiteSpace(connectionString);

// Always register AuthDbContext — even with a placeholder connection string — so the DI container
// can construct AuthAppService/RefreshTokenService/etc. at boot. With a placeholder, the app still
// starts (and non-DB endpoints like /health work); anything that actually touches the database
// fails at request time with a clear error instead of crashing the whole process on startup.
/*
 * Pooled. AddDbContext builds a fresh DbContext per request, which re-runs the model's internal
 * plumbing setup every time; AddDbContextPool reuses instances and resets their state instead. The
 * model configuration itself is cached either way, but the per-instance allocation is not, and under
 * concurrent load that difference is measurable.
 *
 * Safe here because no DbContext in this solution holds request-scoped state injected through its
 * constructor - they take only DbContextOptions, which is what pooling requires.
 */
builder.Services.AddDbContextPool<AuthDbContext>(options =>
    options.UseNpgsql(
        isDbConfigured ? connectionString : "Host=unconfigured;Database=unconfigured;Username=unconfigured;Password=unconfigured",
        npgsqlOptions => npgsqlOptions.EnableRetryOnFailure(
            maxRetryCount: 6,
            maxRetryDelay: TimeSpan.FromSeconds(20),
            errorCodesToAdd: null)));

builder.Services.AddScoped<PasswordHasher>();
builder.Services.AddScoped<SecretProtector>();
builder.Services.AddScoped<JwtTokenService>();
builder.Services.AddScoped<RefreshTokenService>();
builder.Services.AddScoped<PermissionClaimsBuilder>();
builder.Services.AddScoped<AuthAppService>();
builder.Services.AddScoped<AuditLogAppService>();
builder.Services.AddScoped<SystemLogAppService>();
// ApprovalGatingService has no dependency on UserAppService/RoleAppService/ApprovalAppService, so it
// must be registered (and read here) before them to make the dependency direction obvious: gating is
// depended ON by UserAppService/RoleAppService, and ApprovalAppService depends on all three of those —
// never the other way, or ApproveAsync's replay-through-the-original-method call would cycle.
builder.Services.AddScoped<ApprovalGatingService>();
builder.Services.AddScoped<UserAppService>();
builder.Services.AddScoped<UserFieldSchemaAppService>();
builder.Services.AddScoped<ValidationPresetAppService>();
builder.Services.AddScoped<SalutationAppService>();
builder.Services.AddScoped<AuthService.Infrastructure.Validation.UserSchemaValidator>();
builder.Services.AddScoped<RoleAppService>();
builder.Services.AddScoped<ApprovalAppService>();
builder.Services.AddScoped<CheckerAssignmentAppService>();
// Inert without SMTP settings, exactly as Google SSO is inert without a Client ID.
builder.Services.AddScoped<IEmailSender, EmailSender>();
builder.Services.AddScoped<SetPasswordInviteService>();
builder.Services.AddScoped<PermissionCatalogAppService>();
builder.Services.AddScoped<FineCapabilityService>();
builder.Services.AddScoped<DashboardAppService>();
builder.Services.AddScoped<SearchAppService>();
builder.Services.AddMemoryCache();
builder.Services.AddScoped<NavigationAppService>();

/*
 * Redis, when configured — and only then.
 *
 * Leaving ConnectionStrings:Redis blank keeps this service exactly as it was: in-memory caching, an
 * in-process lock, and no SignalR backplane. That is the right default for a single instance and for
 * every local checkout, which is why it needs no configuration at all to run.
 *
 * Set it and three things become correct across replicas at once: a role edit on one instance evicts
 * the navigation catalog every instance reads, an approval decision reaches a client connected to a
 * different instance, and the remote-app health sweep runs on ONE instance instead of every instance
 * probing every remote.
 */
var redisConnectionString = builder.Configuration.GetConnectionString("Redis");
var usingRedis = !string.IsNullOrWhiteSpace(redisConnectionString);

var signalR = builder.Services.AddSignalR();

if (usingRedis)
{
    // AbortOnConnectFail=false for the same reason the DbContext is registered with a placeholder
    // connection string: an unreachable dependency at boot must degrade the service, not crash it
    // into a restart loop. The multiplexer reconnects on its own.
    var redisOptions = ConfigurationOptions.Parse(redisConnectionString!);
    redisOptions.AbortOnConnectFail = false;
    var multiplexer = ConnectionMultiplexer.Connect(redisOptions);

    builder.Services.AddSingleton<IConnectionMultiplexer>(multiplexer);
    builder.Services.AddStackExchangeRedisCache(options =>
        options.ConnectionMultiplexerFactory = () => Task.FromResult<IConnectionMultiplexer>(multiplexer));

    builder.Services.AddSingleton<IPlatformCache, RedisPlatformCache>();
    builder.Services.AddSingleton<IDistributedLock, RedisDistributedLock>();

    // One multiplexer for all three uses, rather than three connections to the same server.
    signalR.AddStackExchangeRedis(options =>
    {
        options.ConnectionFactory = _ => Task.FromResult<IConnectionMultiplexer>(multiplexer);
        options.Configuration.ChannelPrefix = RedisChannel.Literal("omniremit");
    });
}
else
{
    builder.Services.AddSingleton<IPlatformCache, MemoryPlatformCache>();
    builder.Services.AddSingleton<IDistributedLock, InProcessLock>();
}

// Remote micro-frontend registration, absorbed from the retired ModuleRegistry service.
builder.Services.Configure<RemoteHealthOptions>(builder.Configuration.GetSection(RemoteHealthOptions.SectionName));

// Short, and read here rather than inside the client, because a hung remote must not stall a sweep:
// N unreachable apps on the default 100-second timeout would hold the sweep for minutes.
var probeTimeout = builder.Configuration.GetValue<TimeSpan?>($"{RemoteHealthOptions.SectionName}:ProbeTimeout")
    ?? TimeSpan.FromSeconds(5);
builder.Services.AddHttpClient<RemoteManifestClient>(c => c.Timeout = probeTimeout);
builder.Services.AddHttpClient<RemoteCapabilityDiscoveryClient>(c => c.Timeout = TimeSpan.FromSeconds(10));

builder.Services.AddScoped<RemoteAppAppService>();

// Singleton so the background sweep and the on-demand refresh endpoint share one set of
// consecutive-failure counters — two tallies would disagree about whether an app is really down.
builder.Services.AddSingleton<RemoteHealthProber>();
builder.Services.AddHostedService<RemoteAppHealthProbeService>();

builder.Services.AddSingleton<KpiCoalescerService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<KpiCoalescerService>());
builder.Services.AddSingleton<IPlatformEventPublisher, SignalRPlatformEventPublisher>();

// Phase 2: replaying an approved mutation that originated in a remote service means POSTing to THAT
// service's own callback URL — a short timeout keeps one unreachable/slow remote from hanging a
// checker's Approve click indefinitely (the same class of bug RemoteAppAppService.ResyncPermissionsAsync
// hit with an unbounded outbound call).
builder.Services.AddHttpClient<RemoteApprovalCallbackClient>(client => client.Timeout = TimeSpan.FromSeconds(10));

// Response compression. The audit-log list and the permission catalog are the two biggest JSON
// payloads in the platform and both compress extremely well. Enabled for HTTPS too — the BREACH
// attack that made that inadvisable applies to responses reflecting a secret back to the caller,
// which none of these are; they are already access-controlled JSON.
builder.Services.AddResponseCompression(options => options.EnableForHttps = true);

// A health check that actually verifies the database. The previous /health returned a hardcoded
// "ok" literal, so an orchestrator would happily route traffic to a service whose database was
// unreachable — the check could never fail.
builder.Services.AddHealthChecks().AddDbContextCheck<AuthDbContext>("database");

builder.Services.Configure<RefreshTokenCleanupOptions>(builder.Configuration.GetSection(RefreshTokenCleanupOptions.SectionName));
builder.Services.AddHostedService<RefreshTokenCleanupService>();

builder.Services.AddCors(options =>
{
    options.AddPolicy("Frontend", policy =>
    {
        var allowedOrigins = builder.Configuration.GetSection($"{CorsOptions.SectionName}:AllowedOrigins").Get<string[]>() ?? [];
        policy.WithOrigins(allowedOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials(); // required: refresh token travels as an httpOnly cookie
    });
});

var jwtSection = builder.Configuration.GetSection(JwtOptions.SectionName);
var configuredPublicKeyPem = jwtSection["SigningKeyPublic"];
var jwtIssuer = jwtSection["Issuer"] ?? "omniremit-auth-service";
var jwtAudience = jwtSection["Audience"] ?? "omniremit-host";

RSA validationRsa;
if (!string.IsNullOrWhiteSpace(configuredPublicKeyPem))
{
    validationRsa = RsaKeyLoader.LoadPublicKey(configuredPublicKeyPem);
}
else
{
    // No real key configured yet — generate ephemeral key material purely so JwtBearer can wire up
    // without crashing the whole app at boot. Any real token will simply fail signature validation
    // (as it should) until Jwt__SigningKeyPublic/Private are set in Backend/AuthService/.env.
    validationRsa = RSA.Create(2048);
}

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        // Without this, the JWT handler silently remaps short claim names ("sub" in particular) to
        // legacy long-form ClaimTypes URIs before they ever reach a controller — so every
        // User.FindFirst(JwtRegisteredClaimNames.Sub) here and in every other service comes back
        // null even though the token clearly has a "sub" claim. "name" happens not to be in that
        // remap table, which is why actor *names* came through fine while actor *ids* silently didn't.
        options.MapInboundClaims = false;
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;
                if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hubs"))
                {
                    context.Token = accessToken;
                }
                return Task.CompletedTask;
            }
        };
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwtIssuer,
            ValidateAudience = true,
            ValidAudience = jwtAudience,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,

            // Pin the signature algorithm explicitly. The RsaSecurityKey above already makes an HMAC

            // confusion attack fail, but naming the accepted algorithm is the belt-and-braces form and

            // is what an auditor looks for: it makes "alg" non-negotiable rather than key-type-dependent.

            ValidAlgorithms = [SecurityAlgorithms.RsaSha256],
            IssuerSigningKey = new RsaSecurityKey(validationRsa),
            ClockSkew = TimeSpan.FromSeconds(30),
        };
    });

builder.Services.AddAuthorization();

// Rate limiting. Previously absent entirely, which left /api/auth/login accepting unlimited attempts
// per second from one address — online brute force against any weak password.
builder.Services.Configure<RateLimitOptions>(builder.Configuration.GetSection(RateLimitOptions.SectionName));
var rateLimits = builder.Configuration.GetSection(RateLimitOptions.SectionName).Get<RateLimitOptions>()
                 ?? new RateLimitOptions();

builder.Services.AddRateLimiter(options =>
{
    // 429 rather than the default 503: the client is being throttled, it is not a server outage, and
    // the frontend must not mistake this for an infrastructure failure.
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    options.OnRejected = async (context, ct) =>
    {
        if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
        {
            context.HttpContext.Response.Headers.RetryAfter = ((int)retryAfter.TotalSeconds).ToString();
        }

        await context.HttpContext.Response.WriteAsJsonAsync(
            new ProblemDetails
            {
                Title = "Too many attempts. Please wait a moment and try again.",
                Status = StatusCodes.Status429TooManyRequests,
            }, ct);
    };

    // Partitioned by IP: there is no authenticated identity on a login request to key off.
    options.AddPolicy(RateLimitPolicies.Authentication, httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: rateLimits.Enabled
                ? httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown"
                // A single shared partition with an enormous limit is how "disabled" is expressed;
                // returning no limiter at all is not an option the API allows here.
                : "disabled",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = rateLimits.Enabled ? rateLimits.AuthPermitLimit : int.MaxValue,
                Window = TimeSpan.FromSeconds(Math.Max(1, rateLimits.AuthWindowSeconds)),
                QueueLimit = rateLimits.AuthQueueLimit,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            }));

    // Partitioned by user id, NOT by IP. A bank branch sits behind one NAT address, so an IP
    // partition would let one member of staff changing their password lock out the whole office.
    options.AddPolicy(RateLimitPolicies.Sensitive, httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: rateLimits.Enabled
                ? httpContext.User.FindFirstValue(ClaimTypes.NameIdentifier)
                  ?? httpContext.User.FindFirstValue("sub")
                  ?? httpContext.Connection.RemoteIpAddress?.ToString()
                  ?? "unknown"
                : "disabled",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = rateLimits.Enabled ? rateLimits.SensitivePermitLimit : int.MaxValue,
                Window = TimeSpan.FromSeconds(Math.Max(1, rateLimits.SensitiveWindowSeconds)),
                QueueLimit = 0,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            }));
});

builder.Services.Configure<PasswordPolicyOptions>(builder.Configuration.GetSection(PasswordPolicyOptions.SectionName));

// Ensures ANY unhandled exception (a DB connection blip, a bug) becomes a safe, consistent
// ProblemDetails JSON response instead of a bare/empty 500 the frontend can't parse — AppExceptionFilter
// above only covers the small set of expected domain exceptions; this is the catch-all beneath it.
builder.Services.AddProblemDetails();

var app = builder.Build();

/*
 * MUST be the first middleware: everything downstream reads the values it rewrites.
 *
 * In production this service runs behind a TLS-terminating reverse proxy (Render), which forwards
 * plain HTTP and puts the original scheme and client IP in X-Forwarded-Proto / X-Forwarded-For.
 * Without this, three things break, none of them obviously:
 *
 *   1. Request.Scheme reads "http", so UseHttpsRedirection() 307s every API call — including the
 *      CORS preflight OPTIONS, which the browser then reports as an opaque CORS failure. (That
 *      middleware is now gone from this pipeline for the same reason; the proxy already enforces
 *      HTTPS at the edge.)
 *   2. Connection.RemoteIpAddress is the PROXY's address, identical for every user on the platform.
 *      The login rate limiter partitions on it, so 10 attempts/minute stops being per-client and
 *      becomes one shared bucket — one user's retries lock out everyone.
 *   3. Audit entries record that same proxy address as the source IP of every action, which for a
 *      compliance audit trail is worse than recording nothing at all.
 *
 * KnownNetworks/KnownProxies are cleared because the proxy's address is assigned dynamically by the
 * platform and is not knowable ahead of time. That is safe HERE, and only here, because the
 * container accepts traffic solely from that proxy — it is not publicly routable. Do not copy this
 * clearing into a service that is directly reachable from the internet: it would let a caller spoof
 * both its own IP and the request scheme.
 */
var forwardedHeaders = new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
};
forwardedHeaders.KnownNetworks.Clear();
forwardedHeaders.KnownProxies.Clear();
app.UseForwardedHeaders(forwardedHeaders);

if (app.Environment.IsDevelopment())
{
    app.UseDeveloperExceptionPage();
}
else
{
    app.UseExceptionHandler();
}

if (!isDbConfigured)
{
    app.Logger.LogWarning(
        "ConnectionStrings__AuthDb is not set — the app will start, but any endpoint touching the " +
        "database will fail until Backend/AuthService/.env (copied from .env.example) is filled in.");
}
else
{
    /*
     * Migration/seed failure must not kill the process.
     *
     * This block previously let any exception escape Main, so a database that was merely
     * UNREACHABLE — an Azure SQL firewall rule that no longer covers the developer's current IP
     * (error 40615), or a serverless tier still resuming from auto-pause (error 40613) — took the
     * whole service down with an unhandled exception at startup. That contradicts the design stated
     * a few lines above: the app is meant to boot and serve /health even when the database is not
     * usable, so an orchestrator gets an honest unhealthy signal instead of a crash loop.
     *
     * LeadService already did exactly this; the other services did not. Logged as Error (not
     * Warning) because a failure here does mean DB-backed endpoints will not work.
     */
    try
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AuthDbContext>();
        await db.Database.MigrateAsync();
        await AuthDbSeeder.SeedAsync(db, app.Logger);

        // Runs after AuthDbSeeder because it reads the permission features that seeder creates.
        // Restores what the ModuleRegistry absorption migration could not carry across, and reports
        // anything left needing an administrator's attention.
        await RemoteAppSeeder.SeedAsync(db, app.Logger);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex,
            "Database migration/seed failed — the service will still start, but every DB-backed " +
            "endpoint will fail and /health will report Unhealthy until the database is reachable.");
    }
}

if (string.IsNullOrWhiteSpace(configuredPublicKeyPem))
{
    app.Logger.LogWarning(
        "Jwt__SigningKeyPublic/Private are not set — an ephemeral key pair was generated for this " +
        "process only, so no previously issued token (and no token from another instance) will validate. " +
        "Set real values in Backend/AuthService/.env before relying on auth.");
}

using (var scope = app.Services.CreateScope())
{
    if (!scope.ServiceProvider.GetRequiredService<SecretProtector>().IsConfigured)
    {
        app.Logger.LogWarning(
            "Security__TempPasswordKey is not set — approving a gated Create-User request will be " +
            "refused, because the generated temporary password could not be stored for the maker to " +
            "collect. Set it in Backend/AuthService/.env (openssl rand -base64 32).");
    }
}

// Only when Redis is absent. This warning used to fire unconditionally, so once a backplane WAS
// configured it kept reporting a problem that no longer existed — and a warning that is always wrong
// is a warning nobody reads.
var instanceCountStr = builder.Configuration["INSTANCE_COUNT"] ?? Environment.GetEnvironmentVariable("INSTANCE_COUNT") ?? Environment.GetEnvironmentVariable("WEB_CONCURRENCY");
if (!usingRedis && int.TryParse(instanceCountStr, out var instanceCount) && instanceCount > 1)
{
    app.Logger.LogWarning(
        "Instance count is {InstanceCount} but ConnectionStrings:Redis is not set. Without it this "
            + "service is only correct on ONE instance: group broadcasts (approvals/audit) reach only "
            + "the sending instance, the navigation and capability caches are per-process so a "
            + "permission change is served stale by the others, and every instance probes every "
            + "remote app independently.",
        instanceCount);
}
else if (usingRedis)
{
    app.Logger.LogInformation(
        "Redis is configured: SignalR backplane, shared caches and single-writer health probing are active.");
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// Compression before CORS/auth so it wraps every response the pipeline produces.
// Exempt /hubs from response compression because compression buffers and breaks SSE/long-polling fallbacks.
app.UseWhen(
    ctx => !ctx.Request.Path.StartsWithSegments("/hubs"),
    appBuilder => appBuilder.UseResponseCompression());
app.UseCors("Frontend");
// No UseHttpsRedirection(): this runs behind a TLS-terminating proxy that already enforces HTTPS at
// the edge. Redirecting in-app would 307 every call (preflight included) — see UseForwardedHeaders
// above. Locally the services are plain HTTP, so it was never doing useful work there either.
app.UseAuthentication();
app.UseAuthorization();

// AFTER authentication, so the Sensitive policy can partition by the authenticated user id. Placed
// before MapControllers so a throttled request is rejected without reaching a handler.
app.UseRateLimiter();
app.MapControllers();
app.MapHub<PlatformHub>("/hubs/platform", options =>
{
    options.CloseOnAuthenticationExpiration = true;
});

// Real check — reports Unhealthy (503) when the database is unreachable, instead of the previous
// hardcoded "ok" that could never fail.
app.MapHealthChecks("/health").WithName("HealthCheck");

app.Run();
