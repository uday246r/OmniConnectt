using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using ProductMarketplace.Application.Interfaces;
using ProductMarketplace.Infrastructure.Data;
using ProductMarketplace.Infrastructure.Services;

namespace ProductMarketplace.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        // The connection string is deliberately not committed to appsettings.json. Program.cs loads it
        // from backend/.env (gitignored, local-only) before configuration is built; a real environment
        // variable - set by a container, CI, or a deployed host - always takes precedence over .env.
        // Either way it surfaces here as ConnectionStrings:DefaultConnection, so a credential never
        // lives in source control.
        var connectionString = configuration.GetConnectionString("DefaultConnection");

        /*
         * A missing connection string no longer stops the process from starting.
         *
         * Throwing here took the whole service down — including /health and /permissions, which is how
         * the host notices a remote is broken and still shows its sidebar entry with a maintenance state.
         * The service now starts, logs the problem (Program.cs), and fails only the requests that need the
         * database, the same way LeadService and Customer360Service behave.
         */
        var configured = !string.IsNullOrWhiteSpace(connectionString);

        // Pooled: instances are reset and reused instead of rebuilt per request, which matters under
        // concurrent load. Safe because AppDbContext takes nothing but its options.
        services.AddDbContextPool<AppDbContext>(options =>
            options.UseNpgsql(
                configured ? WithWarmPool(connectionString!, configuration) : "Host=unconfigured;Database=unconfigured;Username=unconfigured;Password=unconfigured",
                npgsql =>
                {
                    // Neon's serverless compute auto-suspends on idle; the first query after a suspend
                    // can trip a transient failure, which retry-on-failure absorbs.
                    npgsql.EnableRetryOnFailure(maxRetryCount: 5, maxRetryDelay: TimeSpan.FromSeconds(10), errorCodesToAdd: null);
                    npgsql.CommandTimeout(30);
                }));

        // Read once per request, so a request that filters products and then reports on them asks Setup
        // which statuses are live a single time — and never serves a stale answer across instances.
        services.AddScoped<ICatalogStatuses, CatalogStatuses>();

        services.AddScoped<ICategoryService, CategoryService>();
        services.AddScoped<ISubCategoryService, SubCategoryService>();
        services.AddScoped<IProductService, ProductService>();
        services.AddScoped<IDashboardService, DashboardService>();
        services.AddScoped<IAuditLogService, AuditLogService>();
        services.AddScoped<IDocumentDefinitionService, DocumentDefinitionService>();
        services.AddScoped<IStatusConfigService, StatusConfigService>();
        services.AddSignalR();

        return services;
    }

    /*
     * A few database connections kept open, and kept alive.
     *
     * Npgsql opens connections on demand and closes idle ones after five minutes, and each new connection
     * to the managed database costs a TLS handshake of around two seconds from a developer machine, so the
     * first page after a quiet spell waited on a handshake per request. `Database:MinimumPoolSize`
     * (default 3; 0 turns it off) keeps that many open and a 30 s TCP keepalive stops idle ones being
     * dropped. Only applied when the connection string does not already set these. Open connections also
     * keep a serverless database from auto-suspending while the service runs.
     */
    private static string WithWarmPool(string connectionString, IConfiguration configuration)
    {
        var npgsql = new Npgsql.NpgsqlConnectionStringBuilder(connectionString);
        var minimum = configuration.GetValue<int?>("Database:MinimumPoolSize") ?? 3;
        if (npgsql.MinPoolSize == 0 && minimum > 0) npgsql.MinPoolSize = Math.Min(minimum, npgsql.MaxPoolSize);
        if (npgsql.KeepAlive == 0) npgsql.KeepAlive = 30;
        return npgsql.ConnectionString;
    }

}
