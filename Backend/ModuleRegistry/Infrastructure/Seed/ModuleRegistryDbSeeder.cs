using Microsoft.EntityFrameworkCore;
using ModuleRegistry.Domain;
using ModuleRegistry.Domain.Entities;
using ModuleRegistry.Domain.Enums;

namespace ModuleRegistry.Infrastructure.Seed;

public static class ModuleRegistryDbSeeder
{
    public static async Task SeedAsync(ModuleRegistryDbContext db, AuthServiceClient authServiceClient, ILogger logger, CancellationToken ct = default)
    {
        var existingApps = await db.RemoteApps.ToListAsync(ct);
        if (existingApps.Count > 0)
        {
            // The rows are already here, but they may predate navigation metadata — an installation
            // that was seeded before remotes declared their sidebars has capabilities in AuthDb and
            // no nav rows at all. Returning here would leave that installation with app entries and
            // no sub-pages under them until somebody thought to press "Resync Permissions", which
            // is not a discoverable recovery step for a sidebar that simply looks incomplete.
            //
            // Re-pushing is idempotent and cheap: the fetch is one request per remote, and a remote
            // that cannot be reached contributes null nav, which AuthService treats as "keep what
            // you have" rather than clearing anything.
            await BackfillNavigationAsync(existingApps, authServiceClient, logger, ct);
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

        Task PushAsync(RemoteApp app, CancellationToken token) => PushOneAsync(app, authServiceClient, token);
    }

    /// <summary>
    /// Re-pushes capabilities, navigation and render metadata for apps that already exist.
    /// <para>
    /// Skipped once every app has nav rows on the AuthService side — but this service cannot see that
    /// from here, so the cheap proxy is whether any app declares a permissions source at all. The push
    /// itself is idempotent, so a redundant run costs one request per remote at startup and changes
    /// nothing.
    /// </para>
    /// </summary>
    private static async Task BackfillNavigationAsync(
        List<RemoteApp> apps, AuthServiceClient authServiceClient, ILogger logger, CancellationToken ct)
    {
        var withSource = apps
            .Where(a => a.Status != RemoteAppStatus.Disabled && !string.IsNullOrWhiteSpace(a.PermissionsSourceUrl))
            .ToList();

        if (withSource.Count == 0)
        {
            return;
        }

        try
        {
            foreach (var app in withSource)
            {
                await PushOneAsync(app, authServiceClient, ct);
            }
            logger.LogInformation("Backfilled navigation metadata for {Count} existing remote app(s).", withSource.Count);
        }
        catch (Exception ex)
        {
            // Never block startup on this. POST /api/remote-apps/resync-permissions is the manual
            // recovery path, exactly as it is for the capability sync.
            logger.LogWarning(ex, "Could not backfill remote app navigation during seed.");
        }
    }

    private static async Task PushOneAsync(RemoteApp app, AuthServiceClient authServiceClient, CancellationToken ct)
    {
        var discovered = await authServiceClient.FetchRemoteCapabilitiesAsync(app.PermissionsSourceUrl!, ct);
        if (discovered is null)
        {
            // Do not push empty capabilities if the remote service is temporarily unreachable at startup;
            // pushing empty capabilities would deactivate the app's existing submodules in AuthService.
            return;
        }

        await authServiceClient.UpsertAsync(
            app.PermissionFeatureKey,
            app.DisplayName,
            app.SidebarOrder,
            discovered.Capabilities,
            ct,
            discovered.Nav,
            new RemoteAppRenderMetadata(
                app.IconKey, app.ManifestUrl, app.ContainerName, app.Status.ToString(), app.MaintenanceMessage));
    }
}
