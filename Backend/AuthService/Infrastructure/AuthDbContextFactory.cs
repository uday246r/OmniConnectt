using DotNetEnv;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;

namespace AuthService.Infrastructure;

/// <summary>
/// Supplies an <see cref="AuthDbContext"/> to the EF Core command-line tools
/// (<c>dotnet ef migrations add</c>, <c>dotnet ef database update</c>).
/// </summary>
/// <remarks>
/// <para>
/// This resolves the connection string the same way <c>Program.cs</c> does — <c>.env</c>, then
/// <c>appsettings.json</c>, then <c>appsettings.{Environment}.json</c>, then environment variables
/// — and that matters more than it looks. EF prefers a design-time factory over the application's
/// host builder whenever one exists, so a factory carrying its own hardcoded connection string
/// silently points <c>database update</c> at a different database than the one the service runs
/// against. That is exactly what this file used to do.
/// </para>
/// <para>
/// The fallback below is reached only when nothing is configured anywhere, which is the case
/// <c>migrations add</c> cares about: generating a migration never opens a connection, so any
/// syntactically valid string suffices. It is deliberately not a reachable server, so a
/// <c>database update</c> run with no configuration fails loudly instead of quietly creating a
/// stray database.
/// </para>
/// </remarks>
public class AuthDbContextFactory : IDesignTimeDbContextFactory<AuthDbContext>
{
    private const string ConnectionStringName = "AuthDb";

    private const string UnconfiguredFallback =
        "Server=unconfigured;Database=unconfigured;Trusted_Connection=True;TrustServerCertificate=True;";

    public AuthDbContext CreateDbContext(string[] args)
    {
        // The EF tools run with the project directory as the working directory.
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

        var optionsBuilder = new DbContextOptionsBuilder<AuthDbContext>();
        optionsBuilder.UseSqlServer(
            string.IsNullOrWhiteSpace(connectionString) ? UnconfiguredFallback : connectionString);

        return new AuthDbContext(optionsBuilder.Options);
    }
}
