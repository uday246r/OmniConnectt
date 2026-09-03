using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace AuthService.Infrastructure;

/// <summary>
/// Lets `dotnet ef migrations add` run without a real Neon connection string configured (design
/// time only never actually connects to the database to generate a migration). `dotnet ef database
/// update` still uses the real app configuration/DI pipeline, i.e. your .env's ConnectionStrings__AuthDb.
/// </summary>
public class AuthDbContextFactory : IDesignTimeDbContextFactory<AuthDbContext>
{
    public AuthDbContext CreateDbContext(string[] args)
    {
        var optionsBuilder = new DbContextOptionsBuilder<AuthDbContext>();
        optionsBuilder.UseSqlServer("Server=localhost;Database=omniremit_auth_designtime;Trusted_Connection=True;TrustServerCertificate=True;");
        return new AuthDbContext(optionsBuilder.Options);
    }
}
