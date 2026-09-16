using AuthService.Application.DTOs;
using AuthService.Application.Services;
using AuthService.Domain.Entities;
using AuthService.Infrastructure;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// A user's own audit tab: everything they did, and everything done to them.
/// </summary>
/// <remarks>
/// The tab used to filter on the actor alone. The questions people open a user's page to answer are
/// mostly about the other half — who changed this person's role, who disabled them, who approved
/// their account, has anyone been trying their password — and every one of those rows has someone
/// else as the actor. These pin that each kind of "about" row is found, that rows about other people
/// are not, and that the list, the summary and the export all answer the same question.
/// </remarks>
public class AuditInvolvingUserTests : IDisposable
{
    private readonly AuthDbContext db = TestDb.Create("audit-involving");
    private readonly AuditLogAppService audit;
    private static readonly Guid Priya = Guid.NewGuid();
    private static readonly Guid Admin = Guid.NewGuid();
    private static readonly Guid Other = Guid.NewGuid();

    public AuditInvolvingUserTests()
    {
        audit = TestAudit.For(db);
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    private Task Row(Guid? actor, string action, string? entityType, string? entityId, string details) =>
        audit.WriteAsync("AuthService", actor, actor == Admin ? "Admin" : "Someone", action, entityType, entityId, details);

    private async Task SeedAsync()
    {
        await Row(Priya, "auth.login_succeeded", "User", Priya.ToString(), "by: Priya signed in");
        await Row(Admin, "user.updated", "User", Priya.ToString(), "about: role changed");
        await Row(Admin, "user.permission_overrides_replaced", "UserPermissionOverrides", Priya.ToString(), "about: access changed");
        await Row(null, "auth.login_failed", "User", Priya.ToString(), "about: wrong password");

        var approval = new ApprovalRequest
        {
            Id = Guid.NewGuid(), Module = "host.settings.users", Action = "Update", EntityType = "User",
            EntityId = Priya.ToString(), NewDataJson = "{}", Status = "Pending", MakerId = Admin, CheckerId = Other,
        };
        var unrelatedApproval = new ApprovalRequest
        {
            Id = Guid.NewGuid(), Module = "host.settings.users", Action = "Update", EntityType = "User",
            EntityId = Other.ToString(), NewDataJson = "{}", Status = "Pending", MakerId = Admin, CheckerId = Other,
        };
        db.ApprovalRequests.AddRange(approval, unrelatedApproval);
        await db.SaveChangesAsync();
        await Row(Admin, "approval.requested", "ApprovalRequest", approval.Id.ToString(), "about: change sent for approval");
        await Row(Admin, "approval.requested", "ApprovalRequest", unrelatedApproval.Id.ToString(), "other: approval about someone else");

        await Row(Admin, "user.updated", "User", Other.ToString(), "other: another user edited");
        await Row(Admin, "role.created", "Role", Priya.ToString(), "other: a role whose id happens to match");
    }

    [Fact]
    public async Task Rows_by_the_user_and_about_the_user_are_both_found()
    {
        await SeedAsync();

        var result = await audit.ListAsync(1, 100, new AuditLogFilter { InvolvingUserId = Priya });

        var details = result.Items.Select(i => i.Details!).ToList();
        Assert.Equal(5, result.Total);
        Assert.All(details, d => Assert.True(d.StartsWith("by:") || d.StartsWith("about:"), d));
        Assert.Contains("about: change sent for approval", details);
        Assert.Contains("about: wrong password", details);
    }

    [Fact]
    public async Task Rows_about_other_people_are_not_included()
    {
        await SeedAsync();

        var result = await audit.ListAsync(1, 100, new AuditLogFilter { InvolvingUserId = Priya });

        Assert.DoesNotContain(result.Items, i => i.Details!.StartsWith("other:"));
    }

    [Fact]
    public async Task The_about_view_leaves_out_only_what_the_user_did_themselves()
    {
        await SeedAsync();

        var result = await audit.ListAsync(1, 100, new AuditLogFilter { InvolvingUserId = Priya, ExcludeActorUserId = Priya });

        Assert.Equal(4, result.Total);
        Assert.All(result.Items, i => Assert.StartsWith("about:", i.Details));
    }

    [Fact]
    public async Task The_export_and_the_summary_count_the_same_rows_as_the_list()
    {
        await SeedAsync();
        var filter = new AuditLogFilter { InvolvingUserId = Priya };

        var list = await audit.ListAsync(1, 100, filter);
        var summary = await audit.SummaryAsync(filter);
        var export = await audit.ExportCsvAsync(filter);

        Assert.Equal(list.Total, summary.TotalAuditEvents);
        Assert.Equal(list.Total, export.RowCount);
        Assert.Contains("involvingUser", AuditFilterDescription.Describe(filter));
    }

    [Fact]
    public async Task Paging_reaches_every_row_rather_than_a_fixed_pool()
    {
        for (var i = 0; i < 130; i++)
        {
            await Row(Admin, "user.updated", "User", Priya.ToString(), $"about: edit {i}");
        }

        var page1 = await audit.ListAsync(1, 100, new AuditLogFilter { InvolvingUserId = Priya });
        var page2 = await audit.ListAsync(2, 100, new AuditLogFilter { InvolvingUserId = Priya });

        Assert.Equal(130, page1.Total);
        Assert.Equal(30, page2.Items.Count);
        Assert.Empty(page1.Items.Select(i => i.Id).Intersect(page2.Items.Select(i => i.Id)));
    }
}
