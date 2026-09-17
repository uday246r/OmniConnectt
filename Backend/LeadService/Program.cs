using System.Security.Cryptography;
using DotNetEnv;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.AspNetCore.HttpOverrides;
using LeadManagement.Api.Data;
using LeadManagement.Api.Infrastructure;
using LeadManagement.Api.Infrastructure.Security;
using LeadManagement.Api.Middleware;
using LeadManagement.Api.Options;
using LeadManagement.Api.Services;

// Load Backend/LeadService/.env before configuration is read
var currentDir = Directory.GetCurrentDirectory();
var candidateEnvFiles = new[]
{
    Path.Combine(currentDir, "Backend", "LeadService", ".env"),
    Path.Combine(currentDir, ".env"),
    Path.Combine(AppContext.BaseDirectory, ".env")
};

foreach (var envPath in candidateEnvFiles)
{
    if (File.Exists(envPath))
    {
        Env.Load(envPath);
    }
}
Env.TraversePath().Load();

var builder = WebApplication.CreateBuilder(args);

// Add Controllers & OpenAPI
builder.Services.AddControllers()
    .ConfigureApiBehaviorOptions(options =>
    {
        /*
         * [ApiController] answers an invalid body itself, before the action runs, with a
         * ValidationProblemDetails. The actions used to check ModelState by hand to return this service's
         * { success, message, errors } envelope instead — code that could never run, so the form got a
         * shape it does not read and showed a generic error. The envelope is produced here now, with
         * errors keyed by the form's own camelCase field names.
         */
        options.InvalidModelStateResponseFactory = context =>
        {
            var errors = context.ModelState
                .Where(entry => entry.Value?.Errors.Count > 0)
                .ToDictionary(
                    entry => ToFieldName(entry.Key),
                    entry => entry.Value!.Errors[0].ErrorMessage is { Length: > 0 } message
                        ? message
                        : "This value is not valid.");

            return new Microsoft.AspNetCore.Mvc.BadRequestObjectResult(new LeadManagement.Api.Models.Dtos.ApiResponseDto<object>
            {
                Success = false,
                Message = errors.Values.FirstOrDefault() ?? "Some details are not valid.",
                Errors = errors,
            });

            static string ToFieldName(string key)
            {
                var name = key.StartsWith("$.", StringComparison.Ordinal) ? key[2..] : key;
                return name.Length > 0 ? char.ToLowerInvariant(name[0]) + name[1..] : "request";
            }
        };
    });
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
// Lets AuthServiceClient read the real caller's IP/User-Agent off the current request when it pushes
// an audit-log entry to AuthService, instead of that entry showing this server's own address.
builder.Services.AddHttpContextAccessor();

// Response compression
builder.Services.AddResponseCompression(options => options.EnableForHttps = true);

// Configure Options
builder.Services.Configure<CorsOptions>(builder.Configuration.GetSection(CorsOptions.SectionName));
builder.Services.Configure<JwtValidationOptions>(builder.Configuration.GetSection(JwtValidationOptions.SectionName));
builder.Services.Configure<AuthIntegrationOptions>(builder.Configuration.GetSection(AuthIntegrationOptions.SectionName));
// Phase 2 Maker-Checker: Internal guards the inbound internal/approvals/apply endpoint AuthService
// calls to replay an approved Lead mutation; Self holds this service's own callback base URL and the
// live module key it was registered under.
builder.Services.Configure<InternalApiOptions>(builder.Configuration.GetSection(InternalApiOptions.SectionName));
builder.Services.Configure<SelfOptions>(builder.Configuration.GetSection(SelfOptions.SectionName));

// Database Context
/*
 * Pooled. AddDbContext builds a fresh DbContext per request, which re-runs the model's internal
 * plumbing setup every time; AddDbContextPool reuses instances and resets their state instead. The
 * model configuration itself is cached either way, but the per-instance allocation is not, and under
 * concurrent load that difference is measurable.
 *
 * Safe here because no DbContext in this solution holds request-scoped state injected through its
 * constructor - they take only DbContextOptions, which is what pooling requires.
 */
var connectionString = builder.Configuration.GetConnectionString("LeadDb")
    ?? builder.Configuration.GetConnectionString("DefaultConnection");
var isDbConfigured = !string.IsNullOrWhiteSpace(connectionString);

builder.Services.AddDbContextPool<ApplicationDbContext>(options =>
    options.UseNpgsql(
        isDbConfigured ? WithWarmPool(connectionString!, builder.Configuration) : "Host=unconfigured;Database=unconfigured;Username=unconfigured;Password=unconfigured",
        npgsqlOptions => npgsqlOptions.EnableRetryOnFailure(
            maxRetryCount: 6,
            maxRetryDelay: TimeSpan.FromSeconds(20),
            errorCodesToAdd: null)));

builder.Services.AddHealthChecks().AddDbContextCheck<ApplicationDbContext>("database");

// Application Services & Clients
builder.Services.AddScoped<IMasterDataService, MasterDataService>();
builder.Services.AddScoped<AuditActorContext>();
builder.Services.AddScoped<IAuditLogService, AuditLogService>();
builder.Services.AddScoped<ILeadService, LeadService>();
builder.Services.AddScoped<LeadFieldConfigService>();
builder.Services.AddHttpClient<IDashboardExternalService, DashboardExternalService>();
builder.Services.AddScoped<IDashboardService, DashboardService>();
// Explicit timeout: a gating check now sits in the hot path of every Lead mutation, so an unbounded
// default (100s) would hang the request instead of just delaying a best-effort audit push.
builder.Services.AddHttpClient<AuthServiceClient>(client => client.Timeout = TimeSpan.FromSeconds(10));
builder.Services.AddMemoryCache();
builder.Services.AddSingleton<ValidationPresetClient.LastKnownGood>();
builder.Services.AddHttpClient<ValidationPresetClient>(client => client.Timeout = TimeSpan.FromSeconds(5));
builder.Services.AddHttpClient<FineCapabilityClient>(client => client.Timeout = TimeSpan.FromSeconds(10));
builder.Services.AddScoped<KpiVisibilityService>();

// CORS Policy
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        /*
         * Fails closed. With no origins configured this used to fall back to allowing ANY origin with
         * credentials — every website a signed-in user visited could call this API as them. An
         * unconfigured deployment now serves no browser origin at all, matching AuthService and
         * Customer360Service; set Cors__AllowedOrigins__0.. in .env.
         */
        var allowedOrigins = builder.Configuration.GetSection($"{CorsOptions.SectionName}:AllowedOrigins").Get<string[]>() ?? [];
        policy.WithOrigins(allowedOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials()
              // Without this the CSV export still downloads, but the browser cannot read the
              // row-count headers — so a truncated file arrives with no warning, which is the
              // exact failure those headers exist to prevent.
              // ETag: Field Settings reads it to save against the version it loaded (see LeadFieldConfigController).
              .WithExposedHeaders([.. LeadManagement.Api.Infrastructure.ExportHeaders.All, "ETag"]);
    });
});

// RS256 JWT Token Validation
var jwtSection = builder.Configuration.GetSection(JwtValidationOptions.SectionName);
var configuredPublicKeyPem = jwtSection["SigningKeyPublic"];
var jwtIssuer = jwtSection["Issuer"] ?? "omniconnect-auth-service";
var jwtAudience = jwtSection["Audience"] ?? "omniconnect-host";

RSA validationRsa;
if (!string.IsNullOrWhiteSpace(configuredPublicKeyPem))
{
    validationRsa = LeadManagement.Api.Infrastructure.RsaKeyLoader.LoadPublicKey(configuredPublicKeyPem);
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

var app = builder.Build();

/*
 * MUST run before anything that reads the client address.
 *
 * This service had no forwarded-headers handling at all, alone among the three — so behind a proxy
 * Connection.RemoteIpAddress is the PROXY's address, and that is what every audit row this service
 * wrote recorded as the actor's origin. An audit trail whose source IP is the infrastructure's is
 * not merely unhelpful, it is wrong in a way that looks right.
 *
 * KnownNetworks/KnownProxies are cleared because the platform assigns the proxy address dynamically,
 * which is safe only while this container is reachable solely through that proxy — the same
 * reasoning, and the same caveat, as AuthService and Customer360Service already carry.
 */
var forwardedHeaders = new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
};
forwardedHeaders.KnownNetworks.Clear();
forwardedHeaders.KnownProxies.Clear();
app.UseForwardedHeaders(forwardedHeaders);

// Service path base for remote integration
app.UsePathBase("/api/lead-service");

// Exception handling sits outside Authentication and CORS
app.UseMiddleware<ExceptionMiddleware>();

app.UseResponseCompression();

app.UseCors("AllowFrontend");

app.UseAuthentication();
app.UseAuthorization();

// `|| true` previously made the environment check dead code, exposing Swagger — and with it every
// route, request/response shape, and the fact that /token exists — in every environment, production
// included. Every other service in this repo gates Swagger the same way.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.MapControllers();
app.MapHealthChecks("/health");
// Liveness without dependencies; /health (readiness) opens a database connection per call.
app.MapHealthChecks("/health/live", new Microsoft.AspNetCore.Diagnostics.HealthChecks.HealthCheckOptions { Predicate = _ => false });

// Initialize database if connection string is configured
var dbConnection = builder.Configuration.GetConnectionString("LeadDb")
    ?? builder.Configuration.GetConnectionString("DefaultConnection");

if (string.IsNullOrWhiteSpace(dbConnection))
{
    app.Logger.LogWarning(
        "ConnectionStrings__LeadDb is not set — app will start, but database endpoints will fail until Backend/LeadService/.env is configured.");
}
else
{
    try
    {
        using var scope = app.Services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        // EnsureCreatedAsync() bypasses EF's migration system entirely — it cannot apply future
        // schema changes and leaves no history of what's been applied, unlike every other service in
        // this repo. The live database has been baselined onto a real InitialCreate migration
        // (Migrations/20260818182525_InitialCreate.cs, verified column-for-column identical to the
        // schema EnsureCreatedAsync had already produced before switching), so MigrateAsync is a
        // no-op here and a real migration path from now on.
        await dbContext.Database.MigrateAsync();
        await LeadDbSeeder.SeedAsync(dbContext);
        await scope.ServiceProvider.GetRequiredService<LeadFieldConfigService>().EnsureSeededAsync();
        app.Logger.LogInformation("Database initialized and seeded successfully.");
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "An error occurred while initializing the database.");
    }
}

if (string.IsNullOrWhiteSpace(configuredPublicKeyPem))
{
    app.Logger.LogWarning(
        "Jwt__SigningKeyPublic is not set — an ephemeral RSA key was generated for this process only.");
}

app.Run();

/*
 * A few database connections kept open, and kept alive.
 *
 * Npgsql opens connections on demand and closes idle ones after five minutes, and each new connection
 * to the managed database costs a TLS handshake of around two seconds from a developer machine. The
 * first page after a quiet spell therefore waited on handshakes for every request it made at once
 * (the Lead dashboard's five charts took ~3.9 s against ~0.3 s warm). `Database:MinimumPoolSize`
 * (default 3; 0 turns it off) keeps that many open, and a 30 s TCP keepalive stops idle ones being
 * dropped in between. Only applied when the connection string does not already set these. Note that
 * open connections also keep a serverless database from auto-suspending while the service runs.
 */
static string WithWarmPool(string connectionString, IConfiguration configuration)
{
    var npgsql = new Npgsql.NpgsqlConnectionStringBuilder(connectionString);
    var minimum = configuration.GetValue<int?>("Database:MinimumPoolSize") ?? 3;
    if (npgsql.MinPoolSize == 0 && minimum > 0) npgsql.MinPoolSize = Math.Min(minimum, npgsql.MaxPoolSize);
    if (npgsql.KeepAlive == 0) npgsql.KeepAlive = 30;
    return npgsql.ConnectionString;
}
