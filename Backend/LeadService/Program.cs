using System.Security.Cryptography;
using DotNetEnv;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using LeadManagement.Api.Data;
using LeadManagement.Api.Infrastructure;
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
builder.Services.AddControllers();
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
builder.Services.AddDbContextPool<ApplicationDbContext>(options =>
{
    var connectionString = builder.Configuration.GetConnectionString("LeadDb")
        ?? builder.Configuration.GetConnectionString("DefaultConnection");

    options.UseSqlServer(
        !string.IsNullOrWhiteSpace(connectionString)
            ? connectionString
            : "Server=unconfigured;Database=unconfigured;Trusted_Connection=True;TrustServerCertificate=True;",
        /*
         * Transient-fault resiliency. REQUIRED against Azure SQL, not a nicety.
         *
         * The serverless tier auto-pauses after an idle period and takes tens of seconds to resume.
         * The first connection after that window fails with error 40613, "Database '...' is not
         * currently available. Please retry the connection later." — which is precisely what a
         * developer sees on the first `dotnet run` of the day, and what a cold production instance
         * sees after a quiet night. The connection string's own `Connection Timeout=30` is shorter
         * than a typical resume, so a single attempt reliably loses that race.
         *
         * EF's SqlServerRetryingExecutionStrategy already classifies 40613 (and 40197/40501/49918
         * and friends) as transient, so this turns a hard startup failure into a short wait. The
         * delay is raised above the 30s default because a resume can legitimately take longer.
         *
         * Safe to enable here: this service issues no explicit BeginTransaction, so nothing needs
         * wrapping in an execution strategy (contrast AuthService's ApprovalAppService.ApproveAsync).
         */
        sqlOptions => sqlOptions.EnableRetryOnFailure(
            maxRetryCount: 6,
            maxRetryDelay: TimeSpan.FromSeconds(20),
            errorNumbersToAdd: null));
});


builder.Services.AddHealthChecks().AddDbContextCheck<ApplicationDbContext>("database");

// Application Services & Clients
builder.Services.AddScoped<IMasterDataService, MasterDataService>();
builder.Services.AddScoped<IAuditLogService, AuditLogService>();
builder.Services.AddScoped<ILeadService, LeadService>();
builder.Services.AddScoped<LeadFieldConfigService>();
builder.Services.AddHttpClient<IDashboardExternalService, DashboardExternalService>();
builder.Services.AddScoped<IDashboardService, DashboardService>();
// Explicit timeout: a gating check now sits in the hot path of every Lead mutation, so an unbounded
// default (100s) would hang the request instead of just delaying a best-effort audit push.
builder.Services.AddHttpClient<AuthServiceClient>(client => client.Timeout = TimeSpan.FromSeconds(10));

// CORS Policy
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        var allowedOrigins = builder.Configuration.GetSection($"{CorsOptions.SectionName}:AllowedOrigins").Get<string[]>();
        if (allowedOrigins != null && allowedOrigins.Length > 0)
        {
            policy.WithOrigins(allowedOrigins)
                  .AllowAnyHeader()
                  .AllowAnyMethod()
                  .AllowCredentials();
        }
        else
        {
            policy.SetIsOriginAllowed(_ => true)
                  .AllowAnyHeader()
                  .AllowAnyMethod()
                  .AllowCredentials();
        }
    });
});

// RS256 JWT Token Validation
var jwtSection = builder.Configuration.GetSection(JwtValidationOptions.SectionName);
var configuredPublicKeyPem = jwtSection["SigningKeyPublic"];
var jwtIssuer = jwtSection["Issuer"] ?? "omniremit-auth-service";
var jwtAudience = jwtSection["Audience"] ?? "omniremit-host";

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
