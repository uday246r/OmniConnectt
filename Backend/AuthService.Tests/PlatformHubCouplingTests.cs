using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Security;
using AuthService.Infrastructure.Seed;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// The dependency between real-time group membership and the capability <b>type</b> of three
/// permissions — the one way this design can break with no error anywhere.
/// </summary>
/// <remarks>
/// <para>
/// <see cref="AuthService.Hubs.PlatformHub"/> decides group membership by reading the <c>perms</c>
/// claim. That claim is minted by <see cref="PermissionClaimsBuilder"/>, which deliberately carries
/// only capabilities typed <see cref="CapabilityType.Api"/> — everything else is delivered out of
/// band to keep the token bounded.
/// </para>
/// <para>
/// So the hub works only for as long as the approvals, audit-log and checker-assignment capabilities
/// stay <c>Api</c>. Re-type any of them to a UI capability and every non-administrator silently stops
/// joining that group: the permission is simply absent from the token, so there is nothing to match,
/// no exception, and not even the hub's own fail-closed catch runs. The tab just stops updating, and
/// the only way to find out is for somebody to notice.
/// </para>
/// <para>
/// These tests are that alarm. They assert the end-to-end fact the hub actually depends on — that a
/// user granted the capability gets it in their minted claim — rather than checking a column, so they
/// keep working regardless of how the seeder expresses the type.
/// </para>
/// </remarks>
public class PlatformHubCouplingTests : IDisposable
{
    private readonly AuthDbContext db;

    public PlatformHubCouplingTests()
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"coupling-{Guid.NewGuid()}")
            .Options;

        db = new AuthDbContext(options);
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    [Theory]
    [InlineData(AuthDbSeeder.HostFeatureKeys.SystemApprovals, "View")]
    [InlineData(AuthDbSeeder.HostFeatureKeys.SystemAuditLogs, "View")]
    [InlineData(AuthDbSeeder.HostFeatureKeys.SystemCheckerAssignment, "View")]
    public async Task The_capabilities_the_hub_gates_on_reach_the_token(string featureKey, string capability)
    {
        var user = await GrantAsync(featureKey, capability);

        var result = await new PermissionClaimsBuilder(db).BuildAsync(user);

        Assert.Contains($"{featureKey}:{capability}", result.Permissions);
    }

    [Fact]
    public async Task A_capability_retyped_away_from_Api_disappears_from_the_token()
    {
        /*
         * The failure mode itself, demonstrated rather than described.
         *
         * This is what the test above is protecting against: change the type and the grant survives in
         * the database, the editor still shows it ticked, and the claim quietly stops carrying it — so
         * the hub finds nothing to match and the user drops off the event stream.
         */
        var user = await GrantAsync(AuthDbSeeder.HostFeatureKeys.SystemApprovals, "View");

        var capabilityRow = await db.PermissionFeatureCapabilities
            .Include(c => c.Feature)
            .FirstAsync(c => c.Feature!.Key == AuthDbSeeder.HostFeatureKeys.SystemApprovals && c.Key == "View");
        capabilityRow.Type = CapabilityType.Ui;
        await db.SaveChangesAsync();

        var result = await new PermissionClaimsBuilder(db).BuildAsync(user);

        Assert.DoesNotContain($"{AuthDbSeeder.HostFeatureKeys.SystemApprovals}:View", result.Permissions);
    }

    private async Task<User> GrantAsync(string featureKey, string capability)
    {
        var feature = new PermissionFeature
        {
            Id = Guid.NewGuid(),
            Key = featureKey,
            DisplayName = featureKey,
            Source = PermissionFeatureSource.Host,
            IsActive = true,
        };
        db.PermissionFeatures.Add(feature);

        db.PermissionFeatureCapabilities.Add(new PermissionFeatureCapability
        {
            Id = Guid.NewGuid(),
            FeatureId = feature.Id,
            Key = capability,
            DisplayName = capability,
            // Api is the default a host capability is seeded with, and the whole point of the
            // coupling: state it explicitly so the test is about the type, not about a default.
            Type = CapabilityType.Api,
            IsActive = true,
        });

        var role = new Role { Id = Guid.NewGuid(), Name = "Checker" };
        db.Roles.Add(role);
        db.RolePermissions.Add(new RolePermission
        {
            Id = Guid.NewGuid(),
            RoleId = role.Id,
            FeatureId = feature.Id,
            Capability = capability,
        });

        var user = new User
        {
            Id = Guid.NewGuid(),
            Name = "Checker",
            Email = "checker@example.com",
            RoleId = role.Id,
        };
        db.Users.Add(user);

        await db.SaveChangesAsync();
        return user;
    }
}
