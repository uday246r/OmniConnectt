using DotNetEnv;
using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Api.Services;
using ProductMarketplace.Application.Interfaces;
using ProductMarketplace.Infrastructure;
using ProductMarketplace.Infrastructure.Data;
using ProductMarketplace.Infrastructure.Data.Seed;
using ProductMarketplace.Infrastructure.Realtime;

// Loads backend/.env (gitignored, developer-local) into process environment variables before
// configuration is built, so ConnectionStrings__DefaultConnection etc. are picked up by the
// environment-variables configuration provider ASP.NET Core adds by default - no extra wiring below.
// NoClobber: a variable already set in the real environment (CI, a container, a deployed host) always
// wins over the .env file, which only exists for local development. TraversePath: also finds .env when
// the working directory is a subfolder (e.g. an IDE debug session), while still resolving to
// backend/.env in the normal `dotnet run` case. Missing file is not an error - env vars or (as a
// last resort for anyone still using it) user-secrets can supply configuration instead.
Env.TraversePath().NoClobber().Load();

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers().AddJsonOptions(options =>
{
    options.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
    options.JsonSerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter());
});

builder.Services.AddInfrastructure(builder.Configuration);

builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<IAuditContext, HttpAuditContext>();

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Allowed origins come from configuration so each environment (and, later, the Host App shell that
// mounts this remote) can declare its own without a code change.
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
    ?? new[] { "http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5004", "http://127.0.0.1:5004" };

builder.Services.AddCors(options =>
{
    options.AddPolicy("MarketplaceFrontend", policy =>
    {
        policy.WithOrigins(allowedOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

var app = builder.Build();

// Schema migrations default to running on startup, but can be turned off so a deployment can apply
// them as a separate, single-writer step instead of racing across scaled-out instances.
var applyMigrations = builder.Configuration.GetValue("Database:ApplyMigrationsOnStartup", true);
// Sample/demo data must never plant itself in a deployed environment, where it would be
// indistinguishable from real admin-entered records.
var runSeed = builder.Configuration.GetValue("Database:RunSeedOnStartup", app.Environment.IsDevelopment());

if (applyMigrations || runSeed)
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    if (applyMigrations) await db.Database.MigrateAsync();
    if (runSeed)
    {
        await SeedData.SeedAsync(db);
        await SeedData.SeedDocumentDefinitionsAsync(db);
        await SeedData.SeedStatusConfigsAsync(db);
        await SeedData.SeedAnalyticsAndAuditAsync(db);
    }
    else
    {
        // Status values are reference data the API validates every write against, not demo content,
        // so they are provisioned in every environment.
        await SeedData.SeedStatusConfigsAsync(db);
    }
}

if (builder.Configuration.GetValue("Swagger:Enabled", app.Environment.IsDevelopment()))
{
    app.UseSwagger();
    app.UseSwaggerUI(c => c.SwaggerEndpoint("/swagger/v1/swagger.json", "Product Marketplace API v1"));
}

app.UseCors("MarketplaceFrontend");

app.UseExceptionHandler(errorApp =>
{
    errorApp.Run(async context =>
    {
        var feature = context.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>();
        var exception = feature?.Error;

        // InvalidOperationException is this codebase's deliberate "the caller asked for something the
        // domain refuses" channel, so its message is written for the user and is safe to return.
        // Anything else is an unexpected fault: log it with the trace id and return a generic message
        // rather than leaking stack/internal detail to the client.
        var isDomainRule = exception is InvalidOperationException;
        var traceId = context.TraceIdentifier;

        if (!isDomainRule)
        {
            var logger = context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("UnhandledException");
            logger.LogError(exception, "Unhandled exception on {Method} {Path} (traceId: {TraceId})",
                context.Request.Method, context.Request.Path, traceId);
        }

        context.Response.ContentType = "application/problem+json";
        context.Response.StatusCode = isDomainRule ? StatusCodes.Status400BadRequest : StatusCodes.Status500InternalServerError;

        await context.Response.WriteAsJsonAsync(new
        {
            title = isDomainRule ? "Request could not be completed" : "An unexpected error occurred.",
            status = context.Response.StatusCode,
            message = isDomainRule ? exception!.Message : "An unexpected error occurred. Please try again or contact support with the trace id.",
            traceId
        });
    });
});

// No authentication scheme is registered here on purpose. This remote is mounted inside the Host App,
// which owns identity, roles and permissions; the pipeline hook stays in place so Host-issued
// authentication can be added without restructuring. See HttpAuditContext for the actor handoff.
app.UseAuthorization();

app.MapControllers();
app.MapHub<AuditLogHub>("/hubs/audit-log");

app.Run();

public partial class Program { }
