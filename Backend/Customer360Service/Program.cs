using backend.Infrastructure.Security;
using System.Security.Cryptography;
using System.Text;
using DotNetEnv;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using backend.Data;
using backend.Controllers;
using backend.Infrastructure;
using backend.Middleware;
using backend.Options;

foreach (var path in new[] {
    Path.Combine(AppContext.BaseDirectory, ".env"),
    Path.Combine(Directory.GetCurrentDirectory(), "Backend", "Customer360Service", ".env"),
    Path.Combine(Directory.GetCurrentDirectory(), ".env")
})
{
    if (File.Exists(path)) { Env.Load(path); break; }
}
Env.TraversePath().Load();

var builder = WebApplication.CreateBuilder(args);

// ---------------------------------------------------------------------------
// Database — this service's own Postgres DB (field-visibility/masking config, audit trail). New as
// of this feature; previously this service had no database at all. Falls back to an "unconfigured"
// placeholder connection string rather than throwing, matching AuthService's pattern, so the
// service still boots (CRM-proxy endpoints keep working) even before the DB is wired up.
// ---------------------------------------------------------------------------
var connectionString = builder.Configuration.GetConnectionString("Customer360Db");
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

builder.Services.AddDbContextPool<Customer360DbContext>(options =>
    options.UseNpgsql(
        isDbConfigured ? connectionString : "Host=unconfigured;Database=unconfigured;Username=unconfigured;Password=unconfigured",
        npgsqlOptions => npgsqlOptions.EnableRetryOnFailure(
            maxRetryCount: 6,
            maxRetryDelay: TimeSpan.FromSeconds(20),
            errorCodesToAdd: null)));

// ---------------------------------------------------------------------------
// Controllers + JSON serialization
// ---------------------------------------------------------------------------
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.Converters.Add(new backend.Data.DualNamingConverterFactory());
        // ProfileType/MaskingRule (FieldConfig) serialize as their string names ("Individual",
        // "HideFirstShowLast", ...) rather than raw ints, matching what the frontend's TS union
        // types expect.
        options.JsonSerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter());
    });

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSingleton<CrmProxyService>();
// Scoped, not Singleton, now that it reads/writes through a (scoped) DbContext instead of an
// in-memory List + local file.
builder.Services.AddScoped<AuditRepository>();
builder.Services.AddScoped<backend.Infrastructure.Audit.Customer360AuditWriter>();
builder.Services.AddScoped<FieldConfigService>();

// Phase 2 Maker-Checker: this service's first-ever connection to AuthService's internal surface.
// AuthService (outbound: central audit push + gating check/submit), Internal (inbound: guards this
// service's own internal/approvals/apply endpoint), Self (this service's own callback base URL + the
// live module key it was registered under).
builder.Services.Configure<AuthIntegrationOptions>(builder.Configuration.GetSection(AuthIntegrationOptions.SectionName));
builder.Services.Configure<InternalApiOptions>(builder.Configuration.GetSection(InternalApiOptions.SectionName));
builder.Services.Configure<SelfOptions>(builder.Configuration.GetSection(SelfOptions.SectionName));
builder.Services.AddHttpContextAccessor();
// Explicit timeout: a gating check now sits in the hot path of every Field Settings mutation, so an
// unbounded default (100s) would hang the request instead of just delaying a best-effort audit push.
builder.Services.AddHttpClient<AuthServiceClient>(client => client.Timeout = TimeSpan.FromSeconds(10));
builder.Services.AddMemoryCache();
builder.Services.AddHttpClient<FineCapabilityClient>(client => client.Timeout = TimeSpan.FromSeconds(10));

// ---------------------------------------------------------------------------
// CORS Policy
// ---------------------------------------------------------------------------
// Reads Cors:AllowedOrigins, matching AuthService/LeadService exactly
// — this service previously used a differently-named flat "AllowedOrigins" key, computed it into
// `corsOrigins`, and then never used that variable: the actual policy was
// SetIsOriginAllowed(_ => true), i.e. any origin, regardless of what was configured. Fail-closed
// (WithOrigins, no wildcard fallback) matches the platform's other services rather than LeadService's
// permissive-if-empty fallback — appropriate here because real origins are now set in .env.
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
        policy.WithOrigins(allowedOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials()
              // Without this the CSV export still downloads, but the browser cannot read the
              // row-count headers — so a truncated file arrives with no warning, which is the exact
              // failure those headers exist to prevent.
              .WithExposedHeaders(backend.Infrastructure.ExportHeaders.All);
    });
});

// ---------------------------------------------------------------------------
// Authentication — RS256 JWT Token Validation (OmniConnect Platform Standard)
// ---------------------------------------------------------------------------
var jwtSection = builder.Configuration.GetSection("Jwt");
var configuredPublicKeyPem = jwtSection["SigningKeyPublic"] ?? Environment.GetEnvironmentVariable("JWT_SIGNING_KEY_PUBLIC") ?? Environment.GetEnvironmentVariable("Jwt__SigningKeyPublic");
var jwtIssuer = jwtSection["Issuer"] ?? "omniconnect-auth-service";
var jwtAudience = jwtSection["Audience"] ?? "omniconnect-host";

RSA validationRsa;
if (!string.IsNullOrWhiteSpace(configuredPublicKeyPem))
{
    validationRsa = Customer360Service.Infrastructure.RsaKeyLoader.LoadPublicKey(configuredPublicKeyPem);
}
else
{
    validationRsa = RSA.Create(2048);
}

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        // Preserve short claim names ("sub", "perms", "admin") without legacy WS-Security URI remapping
        options.MapInboundClaims = false;
        options.RequireHttpsMetadata = false;
        options.SaveToken = true;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwtIssuer,
            ValidateAudience = true,
            ValidAudience = jwtAudience,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidAlgorithms = [SecurityAlgorithms.RsaSha256],
            IssuerSigningKey = new RsaSecurityKey(validationRsa),
            ClockSkew = TimeSpan.FromSeconds(30),
        };
    });

builder.Services.AddAuthorization();

// ---------------------------------------------------------------------------
// Build and configure the middleware pipeline
// ---------------------------------------------------------------------------
var app = builder.Build();

// First middleware, matching AuthService/LeadService: behind a TLS-terminating
// proxy the real scheme and client IP arrive only as X-Forwarded-* headers. KnownNetworks/KnownProxies
// are cleared because the platform assigns the proxy address dynamically; safe only because this
// container is reachable solely via that proxy.
var forwardedHeaders = new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
};
forwardedHeaders.KnownNetworks.Clear();
forwardedHeaders.KnownProxies.Clear();
app.UseForwardedHeaders(forwardedHeaders);

// Before CORS/auth, matching EmployeeService — otherwise anything thrown by the auth handler bypasses
// it entirely and comes back as a bare 500 with no CORS headers, which the browser reports as an
// opaque CORS failure rather than the real error.
app.UseMiddleware<ExceptionMiddleware>();

app.UseCors("AllowFrontend");
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

if (!isDbConfigured)
{
    app.Logger.LogWarning(
        "ConnectionStrings__Customer360Db is not set — the app will start, but the field-settings " +
        "and audit-log endpoints will fail until Backend/Customer360Service/.env is filled in.");
}
else
{
    // Migration/seed failure must not kill the process — see AuthService/Program.cs for the full
    // rationale. An unreachable database (Azure SQL firewall 40615, serverless resume 40613) should
    // leave the service up and reporting Unhealthy, not crash it at startup. That matters more here
    // than elsewhere: the CRM-proxy endpoints do not touch this database at all and keep working.
    try
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<Customer360DbContext>();
        await db.Database.MigrateAsync();
        // Seeds default field-visibility/masking rows on first boot only (idempotent — a populated
        // table is left untouched), so an admin's edits are never overwritten by a redeploy.
        await scope.ServiceProvider.GetRequiredService<FieldConfigService>().EnsureSeededAsync();
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex,
            "Database migration/seed failed — the service will still start, but the field-settings " +
            "and audit endpoints will fail until the database is reachable. CRM-proxy endpoints are " +
            "unaffected.");
    }
}

if (string.IsNullOrWhiteSpace(configuredPublicKeyPem))
{
    app.Logger.LogWarning(
        "Jwt__SigningKeyPublic is not set — an ephemeral RSA key was generated for this process only.");
}
else
{
    app.Logger.LogInformation("RS256 JWT Public Key loaded successfully.");
}

app.Run();
