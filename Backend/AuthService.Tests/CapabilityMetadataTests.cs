using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// Capability metadata, the capability soft-delete, and the one rule the whole delivery design rests
/// on: a capability is in the JWT if and only if a claim-reading filter enforces it.
/// </summary>
public class CapabilityMetadataTests : IDisposable
{
    private readonly AuthDbContext db;
    private readonly PermissionCatalogAppService catalog;
    private readonly FineCapabilityService fine;

    public CapabilityMetadataTests()
    {
        // A uniquely-named database per instance, and xunit constructs one instance per test, so no
        // test can see another's rows.
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"caps-{Guid.NewGuid()}")
            .Options;

        db = new AuthDbContext(options);

        var memory = new MemoryCache(new MemoryCacheOptions());
        fine = new FineCapabilityService(db, memory);
        catalog = new PermissionCatalogAppService(db, memory, fine);
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    private static UpsertCapabilityRequest Cap(
        string key, string display = "Cap", string type = "Api", string? description = null) =>
        new(key, display, SortOrder: 100, Description: description, Type: type);

    private async Task<PermissionFeature> SyncAsync(params UpsertCapabilityRequest[] caps)
    {
        await catalog.UpsertRemoteAppFeatureAsync("remote.lead", "Lead Management", 10, caps);
        return await db.PermissionFeatures.Include(f => f.Capabilities).FirstAsync(f => f.Key == "remote.lead");
    }

    // ---------------------------------------------------------------- sync

    [Fact]
    public async Task A_remote_that_never_heard_of_the_new_fields_gets_exactly_what_it_always_got()
    {
        // The three-argument form is what reflection-discovered capabilities have always sent. If this
        // stopped producing an active Api capability, every un-upgraded remote would break on sync.
        await catalog.UpsertRemoteAppFeatureAsync(
            "remote.lead", "Lead Management", 10, [new UpsertCapabilityRequest("View", "View")]);

        var cap = await db.PermissionFeatureCapabilities.SingleAsync();

        Assert.Equal(CapabilityType.Api, cap.Type);
        Assert.True(cap.IsActive);
        Assert.Null(cap.GroupKey);
        Assert.Null(cap.Description);
    }

    [Fact]
    public async Task Metadata_a_remote_declares_is_stored()
    {
        await SyncAsync(Cap("kpi.total-leads", "Total Leads", "Widget", "Show the Total Leads card."));

        var cap = await db.PermissionFeatureCapabilities.SingleAsync();

        Assert.Equal(CapabilityType.Widget, cap.Type);
        Assert.Equal("Show the Total Leads card.", cap.Description);
    }

    [Fact]
    public async Task A_dotted_key_is_grouped_by_its_prefix_without_the_remote_saying_so()
    {
        // The third level the permission editor needs comes from the key itself, which is why no third
        // table exists.
        await SyncAsync(Cap("chart.leads-over-time", type: "Chart"), Cap("View"));

        var caps = await db.PermissionFeatureCapabilities.ToDictionaryAsync(c => c.Key, c => c.GroupKey);

        Assert.Equal("chart", caps["chart.leads-over-time"]);
        Assert.Null(caps["View"]);
    }

    [Fact]
    public async Task An_unknown_type_from_a_newer_remote_degrades_to_Api_rather_than_failing_the_sync()
    {
        await SyncAsync(Cap("something", type: "TypeFromTheFuture"));

        Assert.Equal(CapabilityType.Api, (await db.PermissionFeatureCapabilities.SingleAsync()).Type);
    }

    [Fact]
    public async Task Re_syncing_the_same_capability_keeps_its_row_rather_than_recreating_it()
    {
        // Capabilities used to be deleted and re-added wholesale on every sync, so every row got a new
        // Id each time and nothing could reference one.
        var first = await SyncAsync(Cap("View"));
        var id = first.Capabilities.Single().Id;

        await SyncAsync(Cap("View", display: "View Leads"));

        var cap = await db.PermissionFeatureCapabilities.SingleAsync();
        Assert.Equal(id, cap.Id);
        Assert.Equal("View Leads", cap.DisplayName);
    }

    [Fact]
    public async Task A_capability_the_remote_stops_declaring_is_deactivated_not_deleted()
    {
        await SyncAsync(Cap("View"), Cap("Export"));
        await SyncAsync(Cap("View"));

        var export = await db.PermissionFeatureCapabilities.SingleAsync(c => c.Key == "Export");

        // Still there for audit, so the grants naming it stay explicable.
        Assert.False(export.IsActive);
        Assert.True((await db.PermissionFeatureCapabilities.SingleAsync(c => c.Key == "View")).IsActive);
    }

    [Fact]
    public async Task A_capability_that_comes_back_is_grantable_again()
    {
        // A remote that is briefly unreachable or mid-deploy must not permanently cost anyone a
        // permission.
        await SyncAsync(Cap("Export"));
        await SyncAsync(Cap("View"));
        await SyncAsync(Cap("View"), Cap("Export"));

        Assert.True((await db.PermissionFeatureCapabilities.SingleAsync(c => c.Key == "Export")).IsActive);
    }

    [Fact]
    public async Task A_payload_naming_the_same_key_twice_produces_one_row()
    {
        await SyncAsync(Cap("View", display: "First"), Cap("View", display: "Second"));

        var cap = await db.PermissionFeatureCapabilities.SingleAsync();
        Assert.Equal("Second", cap.DisplayName);
    }

    // ---------------------------------------------------------------- catalog read

    [Fact]
    public async Task The_catalog_carries_metadata_and_hides_deactivated_capabilities()
    {
        await SyncAsync(Cap("View"), Cap("kpi.total-leads", "Total Leads", "Widget", "The card."));
        await SyncAsync(Cap("kpi.total-leads", "Total Leads", "Widget", "The card."));

        var feature = Assert.Single(await catalog.GetCatalogAsync(activeOnly: true));
        var cap = Assert.Single(feature.Capabilities);

        // View was withdrawn: it must not be offered, or an administrator would grant something that
        // can never take effect.
        Assert.Equal("kpi.total-leads", cap.Key);
        Assert.Equal("Widget", cap.Type);
        Assert.Equal("kpi", cap.GroupKey);
        Assert.Equal("The card.", cap.Description);
    }

    // ---------------------------------------------------------------- the JWT invariant

    [Fact]
    public async Task A_capability_is_in_the_token_if_and_only_if_it_is_an_Api_capability()
    {
        // The whole scalability argument in one assertion. Api capabilities are read from the claim by
        // the four existing authorization filters, so they must stay. Everything else is delivered out
        // of band, which is what stops the token growing with the taxonomy.
        var feature = await SyncAsync(
            Cap("View"),
            Cap("kpi.total-leads", type: "Widget"),
            Cap("chart.leads-over-time", type: "Chart"),
            Cap("bulk-update", type: "BulkAction"));

        var user = await GrantAsync(feature, "View", "kpi.total-leads", "chart.leads-over-time", "bulk-update");

        var result = await new PermissionClaimsBuilder(db).BuildAsync(user);

        Assert.Equal(["remote.lead:View"], result.Permissions);
    }

    [Fact]
    public async Task A_grant_for_a_capability_no_app_declares_any_more_stops_being_minted()
    {
        // The stale-grant hole: nothing joins RolePermission to the capability row, so a grant used to
        // outlive the capability and keep minting a permission nobody had granted since.
        var feature = await SyncAsync(Cap("View"), Cap("Export"));
        var user = await GrantAsync(feature, "View", "Export");

        await SyncAsync(Cap("View"));

        var result = await new PermissionClaimsBuilder(db).BuildAsync(user);

        Assert.Equal(["remote.lead:View"], result.Permissions);

        // The grant itself survives. This is a delivery change, not a data deletion.
        Assert.Equal(2, await db.RolePermissions.CountAsync());
    }

    [Fact]
    public async Task An_administrator_is_still_unrestricted_and_carries_no_permission_list()
    {
        var feature = await SyncAsync(Cap("View"));
        var user = await GrantAsync(feature, administrator: true);

        var result = await new PermissionClaimsBuilder(db).BuildAsync(user);

        Assert.True(result.IsAdministrator);
        Assert.Empty(result.Permissions);
    }

    [Fact]
    public async Task An_Api_capability_on_a_deactivated_feature_is_not_minted()
    {
        var feature = await SyncAsync(Cap("View"));
        var user = await GrantAsync(feature, "View");

        await catalog.DeactivateRemoteAppFeatureAsync("remote.lead");

        Assert.Empty((await new PermissionClaimsBuilder(db).BuildAsync(user)).Permissions);
    }

    // ------------------------------------------------- the other half of the delivery split

    [Fact]
    public async Task The_fine_grained_set_is_exactly_what_the_token_leaves_out()
    {
        // Together these two assertions are the contract: every capability a user holds is delivered
        // by exactly one path, and neither path drops one. A capability appearing in both would be
        // harmless but wasteful; one appearing in neither would be a permission granted and never
        // honoured, which is the failure worth guarding against.
        var feature = await SyncAsync(
            Cap("View"),
            Cap("Export"),
            Cap("kpi.total-leads", type: "Widget"),
            Cap("export.csv", type: "Export"));

        var user = await GrantAsync(feature, "View", "Export", "kpi.total-leads", "export.csv");

        var minted = (await new PermissionClaimsBuilder(db).BuildAsync(user)).Permissions;
        var resolved = await fine.GetForUserAsync(user.Id);

        Assert.Equal(["remote.lead:Export", "remote.lead:View"], minted);
        Assert.Equal(["remote.lead:export.csv", "remote.lead:kpi.total-leads"], resolved);
        Assert.Empty(minted.Intersect(resolved));
    }

    [Fact]
    public async Task A_capability_the_user_was_never_granted_is_not_in_their_fine_grained_set()
    {
        var feature = await SyncAsync(
            Cap("kpi.total-leads", type: "Widget"),
            Cap("kpi.conversion-rate", type: "Widget"));

        var user = await GrantAsync(feature, "kpi.total-leads");

        Assert.Equal(["remote.lead:kpi.total-leads"], await fine.GetForUserAsync(user.Id));
    }

    [Fact]
    public async Task A_revoke_override_beats_the_role_grant_it_contradicts()
    {
        var feature = await SyncAsync(Cap("kpi.total-leads", type: "Widget"));
        var user = await GrantAsync(feature, "kpi.total-leads");

        db.UserPermissionOverrides.Add(new UserPermissionOverride
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            FeatureId = feature.Id,
            Capability = "kpi.total-leads",
            Effect = PermissionEffect.Revoke,
        });
        await db.SaveChangesAsync();
        fine.InvalidateAll();

        Assert.Empty(await fine.GetForUserAsync(user.Id));
    }

    [Fact]
    public async Task A_user_with_no_role_still_gets_capabilities_granted_directly_to_them()
    {
        // The mirror of a bug already fixed on the JWT path, where "no role" short-circuited before
        // overrides were read at all. The same shape of mistake here would be just as invisible.
        var feature = await SyncAsync(Cap("kpi.total-leads", type: "Widget"));

        var user = new User { Id = Guid.NewGuid(), Name = "Roleless", Email = "roleless@example.com" };
        db.Users.Add(user);
        db.UserPermissionOverrides.Add(new UserPermissionOverride
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            FeatureId = feature.Id,
            Capability = "kpi.total-leads",
            Effect = PermissionEffect.Grant,
        });
        await db.SaveChangesAsync();

        Assert.Equal(["remote.lead:kpi.total-leads"], await fine.GetForUserAsync(user.Id));
    }

    [Fact]
    public async Task An_administrator_holds_every_fine_grained_capability()
    {
        // Unlike the token, which signals this with a flag and an empty list, the browser needs the
        // set enumerated — it has no administrator flag of its own to branch on.
        var feature = await SyncAsync(
            Cap("kpi.total-leads", type: "Widget"),
            Cap("export.csv", type: "Export"));

        var user = await GrantAsync(feature, administrator: true);

        Assert.Equal(["remote.lead:export.csv", "remote.lead:kpi.total-leads"], await fine.GetForUserAsync(user.Id));
    }

    [Fact]
    public async Task A_withdrawn_capability_drops_out_of_the_fine_grained_set_too()
    {
        var feature = await SyncAsync(Cap("kpi.total-leads", type: "Widget"), Cap("kpi.old", type: "Widget"));
        var user = await GrantAsync(feature, "kpi.total-leads", "kpi.old");

        await SyncAsync(Cap("kpi.total-leads", type: "Widget"));

        Assert.Equal(["remote.lead:kpi.total-leads"], await fine.GetForUserAsync(user.Id));
    }

    [Fact]
    public async Task The_answer_uses_the_catalogs_spelling_not_the_grants()
    {
        // Capability keys are authored by hand in two places and matched case-insensitively, so a
        // grant can legitimately disagree with the catalog on casing. The browser has no catalog to
        // normalise against, so it has to be handed one consistent spelling.
        var feature = await SyncAsync(Cap("kpi.total-leads", type: "Widget"));
        var user = await GrantAsync(feature, "KPI.Total-Leads");

        Assert.Equal(["remote.lead:kpi.total-leads"], await fine.GetForUserAsync(user.Id));
    }

    [Fact]
    public async Task A_deleted_user_holds_nothing()
    {
        var feature = await SyncAsync(Cap("kpi.total-leads", type: "Widget"));
        var user = await GrantAsync(feature, "kpi.total-leads");

        user.IsDeleted = true;
        await db.SaveChangesAsync();
        fine.InvalidateAll();

        Assert.Empty(await fine.GetForUserAsync(user.Id));
    }

    // ------------------------------------------------- the size the split exists to protect

    [Fact]
    public async Task A_thousand_business_capabilities_add_nothing_to_the_permission_claim()
    {
        /*
         * The reason for the whole delivery split, asserted as a number.
         *
         * The perms claim is a JSON array serialised into the token. At roughly 40 bytes per entry,
         * a thousand business capabilities would add ~40KB — past Kestrel's 32KB default header limit
         * and well past the 8-16KB most proxies allow, so the user would simply stop being able to
         * sign in. The budget below is generous on purpose: it is not measuring how tight the claim
         * is, it is catching the day someone routes a non-Api capability back into it.
         */
        var declared = new List<UpsertCapabilityRequest> { Cap("View"), Cap("Create") };
        declared.AddRange(Enumerable.Range(0, 1000).Select(i => Cap($"kpi.metric-{i}", type: "Widget")));

        var feature = await SyncAsync([.. declared]);
        var user = await GrantAsync(feature, [.. declared.Select(d => d.Key)]);

        var result = await new PermissionClaimsBuilder(db).BuildAsync(user);

        Assert.Equal(["remote.lead:Create", "remote.lead:View"], result.Permissions);

        var claimBytes = System.Text.Json.JsonSerializer.Serialize(result.Permissions).Length;
        Assert.True(claimBytes < 2048, $"The permission claim grew to {claimBytes} bytes.");

        // And all thousand are still held — delivered by the other path, in full.
        Assert.Equal(1000, (await fine.GetForUserAsync(user.Id)).Count);
    }

    private async Task<User> GrantAsync(PermissionFeature feature, params string[] capabilities) =>
        await GrantAsync(feature, administrator: false, capabilities);

    private async Task<User> GrantAsync(PermissionFeature feature, bool administrator, params string[] capabilities)
    {
        var role = new Role { Id = Guid.NewGuid(), Name = "Tester", IsAdministrator = administrator };
        db.Roles.Add(role);

        foreach (var capability in capabilities)
        {
            db.RolePermissions.Add(new RolePermission
            {
                Id = Guid.NewGuid(),
                RoleId = role.Id,
                FeatureId = feature.Id,
                Capability = capability,
            });
        }

        var user = new User
        {
            Id = Guid.NewGuid(),
            Name = "Tester",
            Email = "tester@example.com",
            RoleId = role.Id,
        };
        db.Users.Add(user);

        await db.SaveChangesAsync();
        return user;
    }
}
