using DotNetEnv;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;

namespace ModuleRegistry.Infrastructure;

/// <summary>
/// Supplies a <see cref="ModuleRegistryDbContext"/> to the EF Core command-line tools — see
/// AuthService's <c>AuthDbContextFactory</c> for the full rationale, which applies identically here.
/// </summary>
public class ModuleRegistryDbContextFactory : IDesignTimeDbContextFactory<ModuleRegistryDbContext>
{
    private const string ConnectionStringName = "RegistryDb";

    private const string UnconfiguredFallback =
        "Host=unconfigured;Database=unconfigured;Username=unconfigured;Password=unconfigured";

    public ModuleRegistryDbContext CreateDbContext(string[] args)
    {
        var projectDirectory = Directory.GetCurrentDirectory();

        var envFile = Path.Combine(projectDirectory, ".env");
        if (File.Exists(envFile))
        {
            Env.Load(envFile);
        }

        var environment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Development";

        var configuration = new ConfigurationBuilder()
            .SetBasePath(projectDirectory)
            .AddJsonFile("appsettings.json", optional: true)
            .AddJsonFile($"appsettings.{environment}.json", optional: true)
            .AddEnvironmentVariables()
            .Build();

        var connectionString = configuration.GetConnectionString(ConnectionStringName);

        var optionsBuilder = new DbContextOptionsBuilder<ModuleRegistryDbContext>();
        optionsBuilder.UseNpgsql(
            string.IsNullOrWhiteSpace(connectionString) ? UnconfiguredFallback : connectionString);

        return new ModuleRegistryDbContext(optionsBuilder.Options);
    }
}
