using System.Security.Cryptography;
using DotNetEnv;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using ModuleRegistry.Application.Services;
using ModuleRegistry.Infrastructure;
using ModuleRegistry.Infrastructure.Security;
using ModuleRegistry.Options;

foreach (var path in new[] {
    Path.Combine(AppContext.BaseDirectory, ".env"),
    Path.Combine(Directory.GetCurrentDirectory(), "Backend", "ModuleRegistry", ".env"),
    Path.Combine(Directory.GetCurrentDirectory(), ".env")
})
{
    if (File.Exists(path)) { Env.Load(path); break; }
}
Env.TraversePath().Load();

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers(options => options.Filters.Add<AppExceptionFilter>());
builder.Services.AddOpenApi();
// Lets AuthServiceClient read the real caller's IP/User-Agent off the current request when it pushes
// an audit-log entry to AuthService, instead of that entry showing this server's own address.
builder.Services.AddHttpContextAccessor();

builder.Services.Configure<CorsOptions>(builder.Configuration.GetSection(CorsOptions.SectionName));
builder.Services.Configure<JwtValidationOptions>(builder.Configuration.GetSection(JwtValidationOptions.SectionName));
builder.Services.Configure<AuthIntegrationOptions>(builder.Configuration.GetSection(AuthIntegrationOptions.SectionName));
builder.Services.Configure<RemoteHealthOptions>(builder.Configuration.GetSection(RemoteHealthOptions.SectionName));
// Phase 2 Maker-Checker: Internal guards the inbound internal/approvals/apply endpoint AuthService
// calls to replay an approved mutation; Self is this service's own externally-reachable base URL,
// handed to AuthService as the CallbackUrl on every gated mutation it submits.
builder.Services.Configure<InternalApiOptions>(builder.Configuration.GetSection(InternalApiOptions.SectionName));
builder.Services.Configure<SelfOptions>(builder.Configuration.GetSection(SelfOptions.SectionName));

var connectionString = builder.Configuration.GetConnectionString("RegistryDb");
var isDbConfigured = !string.IsNullOrWhiteSpace(connectionString);

/*
 * Pooled. AddDbContext builds a fresh DbContext per request, which re-runs the model's internal
 * plumbing setup every time; AddDbContextPool reuses instances and resets their state instead. The
 * model configuration itself is cached either way, but the per-instance allocation is not, and under
 * concurrent load that difference is measurable.
 *
 * Safe here because no DbContext in this solution holds request-scoped state injected through its
 * constructor - they take only DbContextOptions, which is what pooling requires.
 */
builder.Services.AddDbContextPool<ModuleRegistryDbContext>(options =>
    options.UseSqlServer(isDbConfigured ? connectionString : "Server=unconfigured;Database=unconfigured;Trusted_Connection=True;TrustServerCertificate=True;"));

// Explicit timeouts on both outbound clients. Without one, HttpClient inherits the 100-second
// default: a single unreachable remote could hold a request (and its DB connection) for over a
// minute and a half, and a resync across several dead remotes could run for many minutes.
var remoteHealthSection = builder.Configuration.GetSection(RemoteHealthOptions.SectionName);
var probeTimeout = remoteHealthSection.GetValue<TimeSpan?>(nameof(RemoteHealthOptions.ProbeTimeout))
    ?? TimeSpan.FromSeconds(5);

builder.Services.AddHttpClient<AuthServiceClient>(client => client.Timeout = TimeSpan.FromSeconds(10));
builder.Services.AddHttpClient<RemoteManifestClient>(client => client.Timeout = probeTimeout);
builder.Services.AddScoped<RemoteAppAppService>();
// Singleton: the background sweep and the on-demand refresh endpoint must share one set of
// consecutive-failure counters, or they would disagree about whether an app has failed often enough
// to be called down. It resolves its own scopes for the DbContext.
builder.Services.AddSingleton<RemoteHealthProber>();
builder.Services.AddHostedService<RemoteAppHealthProbeService>();

builder.Services.AddResponseCompression(options => options.EnableForHttps = true);

// Verifies the database rather than returning a hardcoded "ok" that could never fail.
builder.Services.AddHealthChecks().AddDbContextCheck<ModuleRegistryDbContext>("database");

builder.Services.AddCors(options =>
{
    options.AddPolicy("Frontend", policy =>
    {
        var allowedOrigins = builder.Configuration.GetSection($"{CorsOptions.SectionName}:AllowedOrigins").Get<string[]>() ?? [];
        policy.WithOrigins(allowedOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

var jwtSection = builder.Configuration.GetSection(JwtValidationOptions.SectionName);
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

// Ensures ANY unhandled exception becomes a safe, consistent ProblemDetails JSON response instead
// of a bare/empty 500 — see AuthService's Program.cs for the identical rationale.
builder.Services.AddProblemDetails();

var app = builder.Build();

// First middleware, for the reasons documented at length in AuthService/Program.cs: behind a
// TLS-terminating proxy the real scheme and client IP arrive only as X-Forwarded-* headers, and
// without restoring them UseHttpsRedirection 307s every API call (preflight included), which the
// browser surfaces as an opaque CORS error. That redirect is removed below — the proxy enforces
// HTTPS at the edge. KnownNetworks/KnownProxies are cleared because the platform assigns the proxy
// address dynamically; safe only because this container is reachable solely via that proxy.
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
        "ConnectionStrings__RegistryDb is not set — the app will start, but any endpoint touching the " +
        "database will fail until Backend/ModuleRegistry/.env (copied from .env.example) is filled in.");
}
else
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<ModuleRegistryDbContext>();
    await db.Database.MigrateAsync();

    var authClient = scope.ServiceProvider.GetRequiredService<AuthServiceClient>();
    await ModuleRegistry.Infrastructure.Seed.ModuleRegistryDbSeeder.SeedAsync(db, authClient, app.Logger);
}

if (string.IsNullOrWhiteSpace(configuredPublicKeyPem))
{
    app.Logger.LogWarning(
        "Jwt__SigningKeyPublic is not set — an ephemeral key was generated for this process only, " +
        "so no token issued by the real AuthService will validate until it's configured to match.");
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseResponseCompression();
app.UseCors("Frontend");
// No UseHttpsRedirection() — see the UseForwardedHeaders comment above.
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

app.MapHealthChecks("/health").WithName("HealthCheck");

app.Run();
