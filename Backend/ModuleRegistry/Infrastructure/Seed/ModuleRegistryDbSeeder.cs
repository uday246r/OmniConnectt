using Microsoft.EntityFrameworkCore;
using ModuleRegistry.Domain;
using ModuleRegistry.Domain.Entities;
using ModuleRegistry.Domain.Enums;

namespace ModuleRegistry.Infrastructure.Seed;

public static class ModuleRegistryDbSeeder
{
    public static async Task SeedAsync(ModuleRegistryDbContext db, AuthServiceClient authServiceClient, ILogger logger, CancellationToken ct = default)
    {
        if (await db.RemoteApps.AnyAsync(ct))
        {
            return;
        }

        logger.LogInformation("Seeding default Remote Apps into ModuleRegistry database...");

        var customer360 = new RemoteApp
        {
            Id = Guid.Parse("11111111-1111-1111-1111-111111111111"),
            Key = "customer360",
            DisplayName = "Customer 360",
            ContainerName = "customer360_mf",
            IconKey = "UserCheck",
            ManifestUrl = "http://localhost:5003/mf-manifest.json",
            SidebarOrder = 1,
            Status = RemoteAppStatus.Active,
            PermissionFeatureKey = "remote.customer360",
            PermissionsSourceUrl = "http://localhost:5059/permissions",
            Health = RemoteAppHealth.Healthy,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };

        var lead = new RemoteApp
        {
            Id = Guid.Parse("22222222-2222-2222-2222-222222222222"),
            Key = "lead",
            DisplayName = "Lead Management",
            ContainerName = "lead_mf",
            IconKey = "Layers",
            ManifestUrl = "http://localhost:5002/mf-manifest.json",
            SidebarOrder = 2,
            Status = RemoteAppStatus.Active,
            PermissionFeatureKey = "remote.lead",
            PermissionsSourceUrl = "http://localhost:5046/api/lead-service/permissions",
            Health = RemoteAppHealth.Healthy,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };

        db.RemoteApps.AddRange(customer360, lead);
        await db.SaveChangesAsync(ct);

        logger.LogInformation("Seeded customer360 and lead RemoteApps into database.");

        try
        {
            await PushAsync(customer360, ct);
            await PushAsync(lead, ct);
            logger.LogInformation("Synced remote app permissions and navigation to AuthService.");
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not push initial remote app permissions to AuthService during seed.");
        }

        async Task PushAsync(RemoteApp app, CancellationToken token)
        {
            var discovered = await authServiceClient.FetchRemoteCapabilitiesAsync(app.PermissionsSourceUrl!, token);
            await authServiceClient.UpsertAsync(
                app.PermissionFeatureKey,
                app.DisplayName,
                app.SidebarOrder,
                discovered?.Capabilities ?? [],
                token,
                discovered?.Nav,
                new RemoteAppRenderMetadata(
                    app.IconKey, app.ManifestUrl, app.ContainerName, app.Status.ToString(), app.MaintenanceMessage));
        }
    }
}
