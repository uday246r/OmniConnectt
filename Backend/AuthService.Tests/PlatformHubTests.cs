using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.Json;
using AuthService.Hubs;
using AuthService.Infrastructure.Security;
using AuthService.Infrastructure.Seed;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.SignalR;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// Which SignalR groups a connection is put into, which is the entire access-control story for the
/// push channel.
/// </summary>
/// <remarks>
/// The hub has no client-invokable methods, so a client cannot ask to join a group — membership is
/// decided once, here, from the token. That makes <c>OnConnectedAsync</c> the only thing standing
/// between a user and an event stream they were not granted, and the reason these assertions are
/// about group names rather than about payloads.
/// </remarks>
public class PlatformHubTests
{
    // ---------------------------------------------------------------- the personal group

    [Fact]
    public async Task Every_authenticated_connection_joins_its_own_user_group()
    {
        var userId = Guid.NewGuid();
        var groups = await ConnectAsync(Principal(userId));

        Assert.Contains(PlatformHub.GroupNames.ForUser(userId), groups);
    }

    [Fact]
    public async Task A_connection_is_aborted_when_the_subject_is_not_a_guid()
    {
        // Not "treated as holding nothing" — aborted. A token whose subject cannot be parsed is
        // malformed, and keeping the socket open would leave a connection nothing can ever address.
        var identity = new ClaimsIdentity(
            [
                new Claim(JwtRegisteredClaimNames.Sub, "not-a-guid"),
                new Claim(JwtTokenService.AdministratorClaimType, "false"),
            ],
            "Test");

        var (groups, aborted) = await ConnectWithAbortAsync(new ClaimsPrincipal(identity));

        Assert.True(aborted);
        Assert.Empty(groups);
    }

    [Fact]
    public async Task An_unauthenticated_connection_is_aborted_and_joins_nothing()
    {
        var (groups, aborted) = await ConnectWithAbortAsync(new ClaimsPrincipal(new ClaimsIdentity()));

        Assert.True(aborted);
        Assert.Empty(groups);
    }

    // ---------------------------------------------------------------- the permission-gated groups

    [Fact]
    public async Task An_administrator_joins_every_viewer_group_without_holding_any_permission()
    {
        var groups = await ConnectAsync(Principal(Guid.NewGuid(), administrator: true));

        Assert.Contains(PlatformHub.GroupNames.ApprovalViewers, groups);
        Assert.Contains(PlatformHub.GroupNames.AuditViewers, groups);
        Assert.Contains(PlatformHub.GroupNames.CheckerAssignmentViewers, groups);
    }

    [Fact]
    public async Task A_user_with_no_permissions_joins_only_their_own_group()
    {
        var userId = Guid.NewGuid();
        var groups = await ConnectAsync(Principal(userId));

        Assert.Equal([PlatformHub.GroupNames.ForUser(userId)], groups);
    }

    [Fact]
    public async Task Each_viewer_group_requires_its_own_permission_and_grants_no_other()
    {
        // The three are independent. Holding approvals must not smuggle in the audit stream, and this
        // is the assertion that would fail if someone collapsed them onto one capability.
        var approvals = await ConnectAsync(Principal(Guid.NewGuid(),
            permissions: [$"{AuthDbSeeder.HostFeatureKeys.SystemApprovals}:View"]));

        Assert.Contains(PlatformHub.GroupNames.ApprovalViewers, approvals);
        Assert.DoesNotContain(PlatformHub.GroupNames.AuditViewers, approvals);
        Assert.DoesNotContain(PlatformHub.GroupNames.CheckerAssignmentViewers, approvals);

        var audit = await ConnectAsync(Principal(Guid.NewGuid(),
            permissions: [$"{AuthDbSeeder.HostFeatureKeys.SystemAuditLogs}:View"]));

        Assert.Contains(PlatformHub.GroupNames.AuditViewers, audit);
        Assert.DoesNotContain(PlatformHub.GroupNames.ApprovalViewers, audit);
    }

    [Fact]
    public async Task Checker_assignment_events_reach_the_capability_that_actually_guards_them()
    {
        /*
         * The regression this exists for.
         *
         * Checker-assignment events were published to approvals.viewers, a deliberately wider
         * audience: CheckerAssignmentsController gates on SystemCheckerAssignment so an ordinary
         * checker can see who else is assigned without being able to reassign. Someone holding that
         * capability and not approvals:View was therefore never in the group carrying their own
         * changes — the tab simply never updated, with nothing to indicate why.
         */
        var groups = await ConnectAsync(Principal(Guid.NewGuid(),
            permissions: [$"{AuthDbSeeder.HostFeatureKeys.SystemCheckerAssignment}:View"]));

        Assert.Contains(PlatformHub.GroupNames.CheckerAssignmentViewers, groups);
        Assert.DoesNotContain(PlatformHub.GroupNames.ApprovalViewers, groups);
    }

    [Fact]
    public async Task Permission_matching_is_case_insensitive_like_the_rest_of_the_platform()
    {
        // The push channel's fan-out has to be exactly the REST read scope. If the two disagreed on
        // casing, a user could be refused an event stream for data the API would happily serve.
        var groups = await ConnectAsync(Principal(Guid.NewGuid(),
            permissions: [$"{AuthDbSeeder.HostFeatureKeys.SystemApprovals}:view"]));

        Assert.Contains(PlatformHub.GroupNames.ApprovalViewers, groups);
    }

    [Fact]
    public async Task An_unparseable_permissions_claim_joins_no_viewer_group_rather_than_all_of_them()
    {
        var userId = Guid.NewGuid();
        var identity = new ClaimsIdentity(
            [
                new Claim(JwtRegisteredClaimNames.Sub, userId.ToString()),
                new Claim(JwtTokenService.AdministratorClaimType, "false"),
                new Claim(JwtTokenService.PermissionsClaimType, "{not json"),
            ],
            "Test");

        var groups = await ConnectAsync(new ClaimsPrincipal(identity));

        // Fails closed, and the connection still stands — the user keeps their own notifications.
        Assert.Equal([PlatformHub.GroupNames.ForUser(userId)], groups);
    }

    [Fact]
    public async Task A_capability_of_a_different_feature_does_not_open_a_viewer_group()
    {
        var groups = await ConnectAsync(Principal(Guid.NewGuid(),
            permissions: ["remote.lead.dashboard:View", "host.settings.users:View"]));

        Assert.DoesNotContain(PlatformHub.GroupNames.ApprovalViewers, groups);
        Assert.DoesNotContain(PlatformHub.GroupNames.AuditViewers, groups);
        Assert.DoesNotContain(PlatformHub.GroupNames.CheckerAssignmentViewers, groups);
    }

    // ---------------------------------------------------------------- helpers

    private static ClaimsPrincipal Principal(
        Guid userId, bool administrator = false, string[]? permissions = null)
    {
        var identity = new ClaimsIdentity(
            [
                new Claim(JwtRegisteredClaimNames.Sub, userId.ToString()),
                new Claim(JwtTokenService.AdministratorClaimType, administrator ? "true" : "false"),
                new Claim(JwtTokenService.PermissionsClaimType, JsonSerializer.Serialize(permissions ?? [])),
            ],
            "Test");

        return new ClaimsPrincipal(identity);
    }

    private static async Task<List<string>> ConnectAsync(ClaimsPrincipal user)
    {
        var (groups, _) = await ConnectWithAbortAsync(user);
        return groups;
    }

    private static async Task<(List<string> Groups, bool Aborted)> ConnectWithAbortAsync(ClaimsPrincipal user)
    {
        var groups = new RecordingGroupManager();
        var context = new FakeHubCallerContext(user);

        var hub = new PlatformHub { Groups = groups, Context = context };
        await hub.OnConnectedAsync();

        return (groups.Joined, context.Aborted);
    }

    /// <summary>Records group joins instead of performing them; the assertions are about which names were asked for.</summary>
    private sealed class RecordingGroupManager : IGroupManager
    {
        public List<string> Joined { get; } = [];

        public Task AddToGroupAsync(string connectionId, string groupName, CancellationToken ct = default)
        {
            Joined.Add(groupName);
            return Task.CompletedTask;
        }

        public Task RemoveFromGroupAsync(string connectionId, string groupName, CancellationToken ct = default)
        {
            Joined.Remove(groupName);
            return Task.CompletedTask;
        }
    }

    private sealed class FakeHubCallerContext(ClaimsPrincipal user) : HubCallerContext
    {
        public bool Aborted { get; private set; }

        public override string ConnectionId { get; } = Guid.NewGuid().ToString();
        public override string? UserIdentifier => user.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
        public override ClaimsPrincipal? User => user;
        public override IDictionary<object, object?> Items { get; } = new Dictionary<object, object?>();
        public override IFeatureCollection Features { get; } = new FeatureCollection();
        public override CancellationToken ConnectionAborted => CancellationToken.None;

        public override void Abort() => Aborted = true;
    }
}
