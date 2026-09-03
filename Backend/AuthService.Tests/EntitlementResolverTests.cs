using AuthService.Application.Entitlements;
using AuthService.Domain.Enums;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// The licensing precedence rules. These are worth testing exhaustively because they are the only
/// thing standing between "this customer did not buy the module" and the module being usable, and
/// because two of the rules deliberately invert the conventions used elsewhere in the codebase:
/// entitlement fails open, and an unlicensed parent is inherited by descendants that have no row.
/// </summary>
public class EntitlementResolverTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 3, 12, 0, 0, TimeSpan.Zero);

    private static EntitlementEntry Entry(
        string key,
        EntitlementStatus status = EntitlementStatus.Licensed,
        EntitlementVisibility visibility = EntitlementVisibility.Normal,
        DateTimeOffset? expiresAt = null,
        string? lockReason = null)
        => new(key, status, visibility, PlanTier: null, LockReason: lockReason, ExpiresAt: expiresAt);

    private static Dictionary<string, EntitlementEntry> Map(params EntitlementEntry[] entries)
        => entries.ToDictionary(e => e.FeatureKey, StringComparer.OrdinalIgnoreCase);

    // ── Fail-open default ────────────────────────────────────────────────────────

    [Fact]
    public void Feature_with_no_row_is_licensed()
    {
        var result = EntitlementResolver.Resolve("remote.lead", Map(), Now);

        Assert.Equal(EntitlementStatus.Licensed, result.Status);
        Assert.Equal(EntitlementOutcome.Available, EntitlementResolver.Outcome(result));
    }

    [Fact]
    public void Empty_map_never_blocks_anything()
    {
        // The state every feature is in immediately after the migration lands and before the seeder
        // has written defaults. Blacking the product out at that moment would be the worst possible
        // failure for a control that is only ever about billing.
        Assert.True(EntitlementResolver.IsAllowed("host.settings.users", Map(), Now));
    }

    // ── Status ───────────────────────────────────────────────────────────────────

    [Fact]
    public void Unlicensed_renders_locked_not_hidden()
    {
        var map = Map(Entry("remote.lead", EntitlementStatus.Unlicensed, lockReason: "Not in your plan."));

        var result = EntitlementResolver.Resolve("remote.lead", map, Now);

        Assert.Equal(EntitlementOutcome.Locked, EntitlementResolver.Outcome(result));
        Assert.Equal("Not in your plan.", result.LockReason);
    }

    [Fact]
    public void Hidden_visibility_beats_everything_including_a_valid_licence()
    {
        var map = Map(Entry("remote.lead", EntitlementStatus.Licensed, EntitlementVisibility.Hidden));

        Assert.Equal(EntitlementOutcome.Hidden, EntitlementResolver.Outcome(
            EntitlementResolver.Resolve("remote.lead", map, Now)));
    }

    [Fact]
    public void Locked_visibility_applies_even_while_licensed()
    {
        // How a module is shown as an upsell before anyone has bought it.
        var map = Map(Entry("remote.lead", EntitlementStatus.Licensed, EntitlementVisibility.Locked));

        Assert.Equal(EntitlementOutcome.Locked, EntitlementResolver.Outcome(
            EntitlementResolver.Resolve("remote.lead", map, Now)));
    }

    // ── Expiry ───────────────────────────────────────────────────────────────────

    [Fact]
    public void Expired_trial_is_treated_as_unlicensed()
    {
        var map = Map(Entry("remote.lead", EntitlementStatus.Trial, expiresAt: Now.AddDays(-1)));

        var result = EntitlementResolver.Resolve("remote.lead", map, Now);

        Assert.Equal(EntitlementStatus.Unlicensed, result.Status);
        Assert.Equal(EntitlementOutcome.Locked, EntitlementResolver.Outcome(result));
    }

    [Fact]
    public void Unexpired_trial_is_usable()
    {
        var map = Map(Entry("remote.lead", EntitlementStatus.Trial, expiresAt: Now.AddDays(1)));

        Assert.True(EntitlementResolver.IsAllowed("remote.lead", map, Now));
    }

    [Fact]
    public void Expiry_is_inclusive_so_the_exact_moment_has_lapsed()
    {
        var map = Map(Entry("remote.lead", EntitlementStatus.Trial, expiresAt: Now));

        Assert.False(EntitlementResolver.IsAllowed("remote.lead", map, Now));
    }

    // ── Parent inheritance ───────────────────────────────────────────────────────

    [Fact]
    public void Submodule_inherits_an_unlicensed_parent()
    {
        // The rule that keeps the admin surface to one toggle per product: switching off
        // remote.lead must switch off every page inside it without four more rows.
        var map = Map(Entry("remote.lead", EntitlementStatus.Unlicensed));

        Assert.False(EntitlementResolver.IsAllowed("remote.lead.dashboard", map, Now));
    }

    [Fact]
    public void Submodule_inherits_a_licensed_parent()
    {
        var map = Map(Entry("remote.lead", EntitlementStatus.Licensed));

        Assert.True(EntitlementResolver.IsAllowed("remote.lead.fieldsettings", map, Now));
    }

    [Fact]
    public void An_explicit_submodule_row_overrides_its_parent()
    {
        // Sells one page separately from the module containing it.
        var map = Map(
            Entry("remote.lead", EntitlementStatus.Licensed),
            Entry("remote.lead.fieldsettings", EntitlementStatus.Unlicensed));

        Assert.True(EntitlementResolver.IsAllowed("remote.lead.dashboard", map, Now));
        Assert.False(EntitlementResolver.IsAllowed("remote.lead.fieldsettings", map, Now));
    }

    [Fact]
    public void A_licensed_submodule_survives_an_unlicensed_parent()
    {
        // Nearest row wins rather than most-restrictive-overall, so a deliberate grant is honoured.
        var map = Map(
            Entry("remote.lead", EntitlementStatus.Unlicensed),
            Entry("remote.lead.dashboard", EntitlementStatus.Licensed));

        Assert.True(EntitlementResolver.IsAllowed("remote.lead.dashboard", map, Now));
    }

    [Fact]
    public void Resolution_reports_the_key_that_was_asked_for_not_the_one_that_matched()
    {
        var map = Map(Entry("remote.lead", EntitlementStatus.Unlicensed));

        var result = EntitlementResolver.Resolve("remote.lead.dashboard", map, Now);

        Assert.Equal("remote.lead.dashboard", result.FeatureKey);
    }

    [Fact]
    public void A_single_segment_key_does_not_walk_past_itself()
    {
        // Guards the ancestor walk against chewing through a key with no dots and looping.
        Assert.True(EntitlementResolver.IsAllowed("dashboard", Map(), Now));
    }

    [Fact]
    public void Sibling_prefixes_do_not_leak_across()
    {
        // "remote.leadgen" must not inherit from "remote.lead" just because one string starts with
        // the other — the walk is segment-wise, not a StartsWith.
        var map = Map(Entry("remote.lead", EntitlementStatus.Unlicensed));

        Assert.True(EntitlementResolver.IsAllowed("remote.leadgen", map, Now));
    }

    [Fact]
    public void Feature_keys_are_matched_case_insensitively()
    {
        var map = Map(Entry("remote.lead", EntitlementStatus.Unlicensed));

        Assert.False(EntitlementResolver.IsAllowed("Remote.Lead", map, Now));
    }
}

/// <summary>
/// The licensing feature's own exemption. Worth its own fixture because the failure mode is not a
/// wrong answer but an unrecoverable installation.
/// </summary>
public class UngateableFeatureTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 3, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void The_licensing_screen_cannot_be_un_licensed()
    {
        // Otherwise switching this row off locks the operator out of the only screen that can switch
        // it back on, and the only way back is a config flag or a manual UPDATE.
        var map = new Dictionary<string, EntitlementEntry>(StringComparer.OrdinalIgnoreCase)
        {
            ["host.settings.licensing"] = new(
                "host.settings.licensing",
                EntitlementStatus.Unlicensed,
                EntitlementVisibility.Hidden,
                null, null, null),
        };

        Assert.True(EntitlementResolver.IsAllowed("host.settings.licensing", map, Now));
        Assert.True(EntitlementResolver.IsUngateable("host.settings.licensing"));
    }

    [Fact]
    public void Ordinary_features_are_not_exempt()
    {
        Assert.False(EntitlementResolver.IsUngateable("host.settings.users"));
        Assert.False(EntitlementResolver.IsUngateable("remote.lead"));
    }
}
