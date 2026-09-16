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
                configured ? connectionString : "Host=unconfigured;Database=unconfigured;Username=unconfigured;Password=unconfigured",
                npgsql =>
                {
                    // Neon's serverless compute auto-suspends on idle; the first query after a suspend
                    // can trip a transient failure, which retry-on-failure absorbs.
                    npgsql.EnableRetryOnFailure(maxRetryCount: 5, maxRetryDelay: TimeSpan.FromSeconds(10), errorCodesToAdd: null);
                    npgsql.CommandTimeout(30);
                }));

        services.AddScoped<ICategoryService, CategoryService>();
        services.AddScoped<IProductTypeService, ProductTypeService>();
        services.AddScoped<IProductService, ProductService>();
        services.AddScoped<IReviewService, ReviewService>();
        services.AddScoped<IPromotionService, PromotionService>();
        services.AddScoped<IApplicationService, ApplicationService>();
        services.AddScoped<IDashboardService, DashboardService>();
        services.AddScoped<IAuditLogService, AuditLogService>();
        services.AddScoped<IDocumentDefinitionService, DocumentDefinitionService>();
        services.AddScoped<IStatusConfigService, StatusConfigService>();
        services.AddScoped<IEmploymentTypeService, EmploymentTypeService>();
        services.AddScoped<IRankingConfigService, RankingConfigService>();
        services.AddSingleton<IFileStorageService, LocalFileStorageService>();
        services.AddSignalR();

        return services;
    }
}
