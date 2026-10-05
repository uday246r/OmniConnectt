using System.Security.Cryptography;
using DotNetEnv;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using ProductMarketplace.Api.Infrastructure;
using ProductMarketplace.Api.Infrastructure.Approvals;
using ProductMarketplace.Api.Infrastructure.Security;
using ProductMarketplace.Api.Options;
using ProductMarketplace.Api.Services;
using ProductMarketplace.Application.Interfaces;
using ProductMarketplace.Infrastructure;
using ProductMarketplace.Infrastructure.Data;
using ProductMarketplace.Infrastructure.Data.Seed;
using ProductMarketplace.Infrastructure.Realtime;

// .env is developer-local and gitignored. It is looked for next to the project, and also under
// Backend/ProductsService when the process is started from the repository root (the launch.json
// entry does exactly that). A real environment variable always wins over the file.
foreach (var candidate in new[]
         {
             Path.Combine(Directory.GetCurrentDirectory(), "Backend", "ProductsService", ".env"),
             Path.Combine(Directory.GetCurrentDirectory(), ".env"),
             Path.Combine(AppContext.BaseDirectory, ".env"),
         })
{
    if (File.Exists(candidate))
    {
        Env.NoClobber().Load(candidate);
    }
}

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers().AddJsonOptions(options =>
{
    options.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
    options.JsonSerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter());
});

builder.Services.Configure<JwtValidationOptions>(builder.Configuration.GetSection(JwtValidationOptions.SectionName));
builder.Services.Configure<AuthIntegrationOptions>(builder.Configuration.GetSection(AuthIntegrationOptions.SectionName));
builder.Services.Configure<InternalApiOptions>(builder.Configuration.GetSection(InternalApiOptions.SectionName));
builder.Services.Configure<SelfOptions>(builder.Configuration.GetSection(SelfOptions.SectionName));

builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddHealthChecks().AddDbContextCheck<AppDbContext>("database");

builder.Services.AddHttpContextAccessor();
builder.Services.AddMemoryCache();
builder.Services.AddScoped<AuditActorOverride>();
builder.Services.AddScoped<IAuditContext, HttpAuditContext>();
builder.Services.AddScoped<IAuditForwarder, CentralAuditForwarder>();
builder.Services.AddSingleton<IAuditViewerPolicy, AuditViewerPolicy>();
builder.Services.AddScoped<ApprovalGate>();
// Bounded: an approval check sits in the path of every gated change, so a hung AuthService must not
// hang the request for the default 100 seconds.
builder.Services.AddHttpClient<AuthServiceClient>(client => client.Timeout = TimeSpan.FromSeconds(10));
builder.Services.AddHttpClient<FineCapabilityClient>(client => client.Timeout = TimeSpan.FromSeconds(10));

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

/*
 * Origins come from configuration only. The previous code fell back to a hardcoded list of localhost
 * ports when none were configured; an unconfigured deployment now serves no browser origin at all,
 * matching every other service. The export row-count headers are exposed so a truncated CSV is reported.
 */
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(options =>
{
    options.AddPolicy("PlatformFrontend", policy =>
    {
        policy.WithOrigins(allowedOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials()
              .WithExposedHeaders(ExportHeaders.All);
    });
});

/*
 * The host platform's RS256 token, validated with its public key.
 *
 * This service registered no authentication at all: every endpoint — product changes, customer
 * applications, uploaded identity documents — answered anonymous callers, and the audit trail named
 * whoever the X-Actor-Name header claimed. It now accepts only tokens AuthService signed, for this
 * platform's audience, exactly as LeadService and Customer360Service do.
 */
var jwt = builder.Configuration.GetSection(JwtValidationOptions.SectionName).Get<JwtValidationOptions>() ?? new JwtValidationOptions();
var validationKey = string.IsNullOrWhiteSpace(jwt.SigningKeyPublic)
    ? RSA.Create(2048)
    : RsaKeyLoader.LoadPublicKey(jwt.SigningKeyPublic);

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwt.Issuer,
            ValidateAudience = true,
            ValidAudience = jwt.Audience,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidAlgorithms = [SecurityAlgorithms.RsaSha256],
            IssuerSigningKey = new RsaSecurityKey(validationKey),
            ClockSkew = TimeSpan.FromSeconds(30),
        };

        // Browsers cannot set headers on a WebSocket, so the live audit feed sends its token as a query
        // parameter — accepted on the hub path only.
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var token = context.Request.Query["access_token"];
                if (!string.IsNullOrEmpty(token) && context.HttpContext.Request.Path.StartsWithSegments("/hubs"))
                {
                    context.Token = token;
                }

                return Task.CompletedTask;
            },
        };
    });
builder.Services.AddAuthorization();

var app = builder.Build();

var forwarded = new ForwardedHeadersOptions { ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto };
forwarded.KnownIPNetworks.Clear();
forwarded.KnownProxies.Clear();
app.UseForwardedHeaders(forwarded);

if (string.IsNullOrWhiteSpace(builder.Configuration.GetConnectionString("DefaultConnection")))
{
    app.Logger.LogError("ConnectionStrings__DefaultConnection is not set. The service is running, but every request that needs the database will fail until it is configured in Backend/ProductsService/.env.");
}
else
{
    // Migrations default to running on startup but can be turned off so a deployment applies them as a
    // single-writer step. A database that cannot be reached is logged, not fatal — /health reports it.
    //
    // Migrating and seeding are two separate try blocks on purpose. They used to share one, so the
    // first exception skipped everything after it — and the failure this service actually hits is a
    // migration one (see the baselining note below), which meant NO seeding had run on any startup:
    // no categories, no product types, no products, and no StatusConfigs, the reference data every
    // write is validated against. An empty catalogue with a stack trace twelve frames up in the log
    // is a hard thing to connect back to its cause, so each step now reports its own outcome.
    using var startupScope = app.Services.CreateScope();
    var db = startupScope.ServiceProvider.GetRequiredService<AppDbContext>();

    if (builder.Configuration.GetValue("Database:ApplyMigrationsOnStartup", true))
    {
        try
        {
            await db.Database.MigrateAsync();
        }
        catch (Exception ex)
        {
            app.Logger.LogError(ex, "Applying migrations on startup failed.");
            await ReportSchemaStateAsync(db, app.Logger);
        }
    }

    try
    {
        if (builder.Configuration.GetValue("Database:RunSeedOnStartup", app.Environment.IsDevelopment()))
        {
            await SeedData.SeedAsync(db);
            await SeedData.SeedDocumentDefinitionsAsync(db);
            await SeedData.SeedAnalyticsAndAuditAsync(db);
        }

        // Status values are reference data every write is validated against, so they exist in every environment.
        await SeedData.SeedStatusConfigsAsync(db);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Seeding the database on startup failed. Reference data may be incomplete.");
    }
}

if (string.IsNullOrWhiteSpace(jwt.SigningKeyPublic))
{
    app.Logger.LogWarning("Jwt__SigningKeyPublic is not set — no platform token will be accepted until it is configured.");
}

if (builder.Configuration.GetValue("Swagger:Enabled", app.Environment.IsDevelopment()))
{
    app.UseSwagger();
    app.UseSwaggerUI(c => c.SwaggerEndpoint("/swagger/v1/swagger.json", "Product Marketplace API v1"));
}

app.UseCors("PlatformFrontend");

app.UseExceptionHandler(errorApp =>
{
    errorApp.Run(async context =>
    {
        var exception = context.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>()?.Error;
        var traceId = context.TraceIdentifier;

        // A record that already has a change waiting: pass AuthService's explanation straight through, so
        // the screen can say what is pending and who it waits on.
        if (exception is ApprovalConflictException conflict)
        {
            context.Response.StatusCode = StatusCodes.Status409Conflict;
            context.Response.ContentType = "application/problem+json";
            await context.Response.WriteAsync(string.IsNullOrWhiteSpace(conflict.ProblemJson)
                ? System.Text.Json.JsonSerializer.Serialize(new { title = conflict.Message, status = 409 })
                : conflict.ProblemJson);
            return;
        }

        var (status, title, message) = exception switch
        {
            // "The caller asked for something the domain refuses" — written for the user and safe to show.
            InvalidOperationException => (StatusCodes.Status400BadRequest, "Request could not be completed", exception.Message),
            // Approval requirement could not be checked: refuse rather than apply unchecked.
            ApprovalServiceUnavailableException => (StatusCodes.Status503ServiceUnavailable, "Approval service unavailable", exception.Message),
            _ => (StatusCodes.Status500InternalServerError, "An unexpected error occurred.",
                "An unexpected error occurred. Please try again or contact support with the trace id."),
        };

        if (status == StatusCodes.Status500InternalServerError)
        {
            app.Logger.LogError(exception, "Unhandled exception on {Method} {Path} (traceId: {TraceId})",
                context.Request.Method, context.Request.Path, traceId);

            // Into the platform's System Logs as well, so an operator sees remote failures in one place.
            await context.RequestServices.GetRequiredService<AuthServiceClient>().PushSystemLogAsync(
                "Error", "unhandled_exception", $"{context.Request.Method} {context.Request.Path}: {exception?.Message}",
                status, exception?.ToString());
        }

        context.Response.ContentType = "application/problem+json";
        context.Response.StatusCode = status;
        await context.Response.WriteAsJsonAsync(new { title, status, message, traceId });
    });
});

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHealthChecks("/health");
// Liveness without dependencies; /health (readiness) opens a database connection per call.
app.MapHealthChecks("/health/live", new Microsoft.AspNetCore.Diagnostics.HealthChecks.HealthCheckOptions { Predicate = _ => false });
app.MapHub<AuditLogHub>("/hubs/audit-log").RequireAuthorization();

app.Run();

/*
 * Says, in one line, which of the two very different situations a migration failure is.
 *
 * A failed migration against an existing database is almost always one of these, and they are told
 * apart by the same two facts — what `__EFMigrationsHistory` records, and which tables are actually
 * there — yet an unaided EF stack trace names neither:
 *
 *   - NEEDS BASELINING. Every table the model expects is present, but no migration is recorded, so EF
 *     believes nothing was ever applied and InitialCreate fails re-creating what exists. A database
 *     whose schema was first created outside the migration system (an `EnsureCreated` call, a restore,
 *     a hand-run script) lands here. The cure is to record the migrations the schema already satisfies,
 *     which is what LeadService did for its own database (see the MigrateAsync note in its Program.cs).
 *     Not done automatically: writing those rows ASSERTS the live schema matches, and a wrong assertion
 *     is permanent and silent — EF would skip the migrations the schema is really missing and the next
 *     symptom would be a missing column at query time instead of a loud failure here.
 *
 *   - HALF-CREATED. Some expected tables are missing. InitialCreate got partway and stopped, so the
 *     conflict and the gap are the same event: the tables it made block the retry, and the tables it
 *     never reached make every read of them fail. Baselining this would be exactly the wrong move; the
 *     migrations need to actually run.
 *
 * Both are reported, never repaired — each remedy writes to or drops from someone's live database, and
 * which one applies is a fact about that database rather than about this code.
 */
static async Task ReportSchemaStateAsync(AppDbContext db, ILogger logger)
{
    try
    {
        /*
         * Which tables exist is asked first and unconditionally. Asking EF what it considers applied is
         * not a reliable opening question here: this runs on the same DbContext whose MigrateAsync just
         * failed, and on that context GetAppliedMigrationsAsync answered from migration state rather
         * than from the (empty) history table — so an early return on it skipped the whole report, which
         * is how this function first came to print nothing at all about a half-created database.
         */
        var present = (await db.Database
                .SqlQuery<string>($"select table_name as \"Value\" from information_schema.tables where table_schema = 'public'")
                .ToListAsync())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var expected = db.Model.GetEntityTypes()
            .Select(e => e.GetTableName())
            .Where(name => !string.IsNullOrEmpty(name))
            .Select(name => name!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var missing = expected.Where(name => !present.Contains(name)).OrderBy(name => name).ToList();
        var recorded = present.Contains("__EFMigrationsHistory")
            ? (await db.Database.SqlQuery<int>(
                $"select count(*)::int as \"Value\" from \"__EFMigrationsHistory\"").SingleAsync())
            : 0;

        if (missing.Count == 0)
        {
            logger.LogError(
                "{Recorded} migrations are recorded in __EFMigrationsHistory, yet all {Expected} tables this "
                + "service expects are present — so migrations look pending and the first one fails re-creating "
                + "them. The schema needs BASELINING: confirm it matches the migrations under "
                + "src/ProductMarketplace.Infrastructure/Data/Migrations, then record their MigrationIds in "
                + "__EFMigrationsHistory. Until then this service runs on whatever schema is already there.",
                recorded, expected.Count);
            return;
        }

        logger.LogError(
            "This database is HALF-CREATED: {Recorded} migrations recorded, {PresentCount} of {Expected} "
            + "expected tables exist, and {MissingCount} are missing ({Missing}). InitialCreate stopped "
            + "partway, so it now fails on the tables it did create while every read of the ones it never "
            + "reached fails too — which is why this service returns no data. Do NOT baseline this; the "
            + "migrations have to run. Drop the partial tables (or the schema) so `dotnet ef database update` "
            + "can apply InitialCreate onwards cleanly, then startup will seed it.",
            recorded, expected.Count - missing.Count, expected.Count, missing.Count, string.Join(", ", missing));
    }
    catch (Exception ex)
    {
        // Diagnosing a failure must never become a second failure.
        logger.LogWarning(ex, "Could not determine the database's schema state.");
    }
}

public partial class Program { }
