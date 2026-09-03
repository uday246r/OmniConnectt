using AuthService.Domain.Enums;

namespace AuthService.Application.Entitlements;

/// <summary>
/// Resolves a feature's effective entitlement. Pure — no DbContext, no clock of its own — so both the
/// navigation tree and the four authorization filters can share one implementation, and so the
/// precedence rules can be unit-tested exhaustively.
/// </summary>
public static class EntitlementResolver
{
    /// <summary>
    /// Resolve <paramref name="featureKey"/> against the entitlement map.
    /// <para>Order: the feature's own row, then its parent's effective entitlement, then an implicit
    /// Licensed default. A sub-module therefore inherits its module's licence without needing a row,
    /// which is what keeps the admin surface to one toggle per product rather than one per page.</para>
    /// <para>Parents are walked by key rather than by navigation property, because the filters that
    /// call this hold only a string from the JWT and never touch the database. The key convention
    /// (<c>remote.lead.dashboard</c> under <c>remote.lead</c>) makes that walk a substring operation.</para>
    /// </summary>
    public static EntitlementEntry Resolve(
        string featureKey,
        IReadOnlyDictionary<string, EntitlementEntry> map,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(featureKey);
        ArgumentNullException.ThrowIfNull(map);

        var own = LookupChain(featureKey, map);
        if (own is null) return EntitlementEntry.LicensedDefault(featureKey);

        var expired = own.Status != EntitlementStatus.Unlicensed
                      && own.ExpiresAt is { } expiry
                      && expiry <= now;

        return expired
            ? own with { Status = EntitlementStatus.Unlicensed, FeatureKey = featureKey }
            : own with { FeatureKey = featureKey };
    }

    /// <summary>
    /// The feature's own row, else the nearest ancestor's, else null.
    /// <para>Most-restrictive-wins falls out of walking upward and stopping at the first row: an
    /// unlicensed parent is inherited by every descendant that has not been explicitly licensed on
    /// its own. A descendant row is an intentional override and is respected as-is — that is how a
    /// single sub-module can be sold separately from the module that contains it.</para>
    /// </summary>
    private static EntitlementEntry? LookupChain(string featureKey, IReadOnlyDictionary<string, EntitlementEntry> map)
    {
        var key = featureKey;
        while (true)
        {
            if (map.TryGetValue(key, out var entry)) return entry;

            var lastDot = key.LastIndexOf('.');
            if (lastDot <= 0) return null;
            key = key[..lastDot];
        }
    }

    /// <summary>
    /// How an effective entitlement presents. Hidden beats everything, then an unlicensed status,
    /// then an explicit Locked override applied even to a licensed feature (which is how a module is
    /// shown as an upsell before anyone has bought it).
    /// </summary>
    public static EntitlementOutcome Outcome(EntitlementEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);

        if (entry.Visibility == EntitlementVisibility.Hidden) return EntitlementOutcome.Hidden;

        // Only Unlicensed blocks. A row still reading Trial here has already been through Resolve,
        // which downgrades a lapsed one — so Trial at this point means "in date", and a trial that
        // renders locked for its whole term is not a trial.
        if (entry.Status == EntitlementStatus.Unlicensed) return EntitlementOutcome.Locked;

        if (entry.Visibility == EntitlementVisibility.Locked) return EntitlementOutcome.Locked;
        return EntitlementOutcome.Available;
    }

    /// <summary>
    /// Features that can never be gated by entitlement, however their rows are set.
    /// <para>
    /// The licensing screen is the only way to undo a licensing mistake. If it could be un-licensed
    /// it would lock the operator out of its own recovery path, leaving a config flag or a manual
    /// UPDATE as the only way back — a lock whose key is stored inside the lock.
    /// </para>
    /// </summary>
    private static readonly HashSet<string> UngateableFeatureKeys =
        new(StringComparer.OrdinalIgnoreCase) { "host.settings.licensing" };

    /// <summary>True when this feature is exempt from the entitlement gate entirely.</summary>
    public static bool IsUngateable(string featureKey) => UngateableFeatureKeys.Contains(featureKey);

    /// <summary>Convenience for the authorization filters, which only care whether to let the request through.</summary>
    public static bool IsAllowed(
        string featureKey,
        IReadOnlyDictionary<string, EntitlementEntry> map,
        DateTimeOffset now)
        => IsUngateable(featureKey) || Outcome(Resolve(featureKey, map, now)) == EntitlementOutcome.Available;
}
