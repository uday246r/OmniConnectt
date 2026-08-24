using EmployeeService.Data;
using EmployeeService.Interfaces.IRepository;
using EmployeeService.Interfaces.IServices;
using EmployeeService.Repositories;
using EmployeeService.Services;
using EmployeeService.Validators;
using FluentValidation;
using FluentValidation.AspNetCore;
using Microsoft.EntityFrameworkCore;

namespace EmployeeService.Extensions;

public static class ServiceExtensions
{
    public static IServiceCollection AddApplicationServices(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("EmployeeDb");
        var isDbConfigured = !string.IsNullOrWhiteSpace(connectionString);

        // Always register AppDbContext — even with a placeholder connection string — so the DI
        // container can construct EmployeeService/EmployeeRepository at boot. With a placeholder,
        // the app still starts (health checks and /permissions still work); anything that actually
        // touches the database fails at request time with a clear error instead of crashing the
        // whole process on startup. Mirrors AuthService/ModuleRegistry's identical pattern.
        /*
         * Pooled. AddDbContext builds a fresh DbContext per request, re-running the per-instance
         * plumbing every time; AddDbContextPool reuses instances and resets their state instead. The
         * model configuration is cached either way, but the per-instance allocation is not, and under
         * concurrent load the difference is measurable.
         *
         * Safe because AppDbContext takes only DbContextOptions — pooling cannot be used with a
         * context that captures request-scoped state through its constructor.
         */
        services.AddDbContextPool<AppDbContext>(options =>
        {
            options.UseNpgsql(isDbConfigured ? connectionString : "Host=unconfigured;Database=unconfigured;Username=unconfigured;Password=unconfigured");
        });

        services.AddScoped<IEmployeeRepository, EmployeeRepository>();

        services.AddScoped<IEmployeeService, Services.EmployeeService>();

        services.AddValidatorsFromAssemblyContaining<CreateEmployeeValidator>();

        // Registering validators does NOT make them run. Without this, CreateEmployeeValidator was
        // resolvable from DI but nothing ever invoked it, so CreateEmployee/UpdateEmployee accepted
        // completely unvalidated input — the validators had never executed once in this service.
        services.AddFluentValidationAutoValidation();

        return services;
    }
}