using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace ModuleRegistry.Infrastructure;

/// <summary>Lets `dotnet ef migrations add` run without a real Neon connection string configured — see AuthService's identical factory for the full rationale.</summary>
public class ModuleRegistryDbContextFactory : IDesignTimeDbContextFactory<ModuleRegistryDbContext>
{
    public ModuleRegistryDbContext CreateDbContext(string[] args)
    {
        var optionsBuilder = new DbContextOptionsBuilder<ModuleRegistryDbContext>();
        optionsBuilder.UseSqlServer("Server=localhost;Database=omniremit_registry_designtime;Trusted_Connection=True;TrustServerCertificate=True;");
        return new ModuleRegistryDbContext(optionsBuilder.Options);
    }
}
