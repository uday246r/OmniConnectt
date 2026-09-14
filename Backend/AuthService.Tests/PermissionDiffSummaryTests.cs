using AuthService.Application.DTOs;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// The one-line headline written into every role and permission-override audit row.
/// </summary>
/// <remarks>
/// The headline is what a reviewer scanning the trail actually reads, and for per-user overrides it
/// used to state the change backwards: a diff's Added/Removed lists say which ROWS changed, while a
/// Revoke override takes access away when it is added and gives it back when it is removed. Found
/// in the browser run, where adding a Revoke override was recorded as "2 permissions granted". Each
/// case below is one way the two axes can combine.
/// </remarks>
public class PermissionDiffSummaryTests
{
    private static PermissionChangeDto Role(string cap) => new("host.settings.users", cap);
    private static PermissionChangeDto Grant(string cap) => new("host.settings.users", cap, "Grant");
    private static PermissionChangeDto Revoke(string cap) => new("host.settings.users", cap, "Revoke");

    private static string Summary(PermissionChangeDto[] added, PermissionChangeDto[] removed) =>
        new PermissionDiffDto(added, removed).Summarise();

    [Fact]
    public void An_unchanged_set_says_so_explicitly()
    {
        Assert.Equal("no permission changes", PermissionDiffDto.Empty.Summarise());
    }

    [Fact]
    public void Role_grants_added_and_removed_read_as_granted_and_revoked()
    {
        var summary = Summary([Role("View"), Role("Edit")], [Role("Delete")]);

        Assert.Equal("2 permissions granted, 1 permission revoked", summary);
    }

    [Fact]
    public void Adding_a_grant_override_reads_as_a_grant()
    {
        Assert.Equal("1 permission granted", Summary([Grant("Delete")], []));
    }

    [Fact]
    public void Adding_a_revoke_override_reads_as_a_revocation_not_a_grant()
    {
        Assert.Equal("1 permission revoked", Summary([Revoke("Delete")], []));
    }

    [Fact]
    public void Lifting_a_revoke_override_reads_as_a_grant_not_a_revocation()
    {
        Assert.Equal("1 permission granted", Summary([], [Revoke("Delete")]));
    }

    [Fact]
    public void Lifting_a_grant_override_reads_as_a_revocation()
    {
        Assert.Equal("1 permission revoked", Summary([], [Grant("Delete")]));
    }

    /// <summary>
    /// One capability, one change. Counting the removed Grant and the added Revoke separately would
    /// report "1 granted, 1 revoked" — two events for a single flip, one of them in the wrong direction.
    /// </summary>
    [Fact]
    public void Flipping_an_override_from_grant_to_revoke_counts_once_as_a_revocation()
    {
        Assert.Equal("1 permission revoked", Summary([Revoke("Delete")], [Grant("Delete")]));
    }

    [Fact]
    public void Flipping_an_override_from_revoke_to_grant_counts_once_as_a_grant()
    {
        Assert.Equal("1 permission granted", Summary([Grant("Delete")], [Revoke("Delete")]));
    }

    [Fact]
    public void The_same_capability_on_different_features_is_judged_separately()
    {
        var summary = Summary(
            [new PermissionChangeDto("host.settings.users", "View", "Revoke")],
            [new PermissionChangeDto("host.settings.roles", "View", "Grant")]);

        Assert.Equal("2 permissions revoked", summary);
    }

    /// <summary>The JSON half keeps the raw rows — only the headline interprets direction.</summary>
    [Fact]
    public void The_structured_details_keep_the_rows_exactly_as_they_changed()
    {
        var details = new PermissionDiffDto([], [Revoke("Delete")]).ToDetails("Changed overrides — 1 permission granted.");

        Assert.Contains("\"removed\"", details);
        Assert.Contains("host.settings.users:Delete (Revoke)", details);
    }

    [Fact]
    public void A_duplicated_row_does_not_break_the_summary()
    {
        Assert.Equal("1 permission granted", Summary([Grant("View"), Grant("View")], []));
    }
}
