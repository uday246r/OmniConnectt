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
        "Server=unconfigured;Database=unconfigured;Trusted_Connection=True;TrustServerCertificate=True;";

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
        optionsBuilder.UseSqlServer(
            string.IsNullOrWhiteSpace(connectionString) ? UnconfiguredFallback : connectionString);

        return new ModuleRegistryDbContext(optionsBuilder.Options);
    }
}
