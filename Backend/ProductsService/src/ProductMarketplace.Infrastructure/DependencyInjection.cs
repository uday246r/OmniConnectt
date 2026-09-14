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
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException(
                "No database connection string configured.\n\n" +
                "Run this once from the backend folder:\n" +
                "  cp .env.example .env\n" +
                "then edit .env and set ConnectionStrings__DefaultConnection to your Postgres connection string.\n\n" +
                "In a deployed environment, set the ConnectionStrings__DefaultConnection environment variable instead.");
        }

        services.AddDbContext<AppDbContext>(options =>
            options.UseNpgsql(connectionString, npgsql =>
            {
                // Neon's serverless compute auto-suspends on idle; the first query after a suspend
                // incurs a cold-start delay and can trip a transient connection failure under
                // concurrent load. Retry-on-failure is the standard mitigation for cloud-hosted
                // Postgres with this kind of scale-to-zero behavior.
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
