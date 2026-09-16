using System.Text;
using System.Text.Json;

namespace AuthService.Application.DTOs;

/// <summary>One grant that was added or removed, named the way the JWT and the Role editor name it.</summary>
/// <param name="Effect">
/// "Grant" or "Revoke" for a per-user override; null for a role grant, which has no effect axis —
/// a role permission exists or it does not.
/// </param>
public sealed record PermissionChangeDto(string FeatureKey, string Capability, string? Effect = null)
{
    public override string ToString() =>
        Effect is null ? $"{FeatureKey}:{Capability}" : $"{FeatureKey}:{Capability} ({Effect})";
}

/// <summary>
/// What actually changed about someone's permissions, for the audit record.
/// </summary>
/// <remarks>
/// <para>
/// Every permission mutation used to be recorded as the bare sentence "Updated role 'Manager' —
/// permissions modified". That says a privilege boundary moved and refuses to say which way. Asking
/// "when did this role gain Delete on Users?" — the question an audit trail of an RBAC system exists
/// to answer — meant diffing database backups.
/// </para>
/// <para>
/// Rendered into <c>AuditLog.Details</c> as a one-line summary followed by JSON. The audit drawer
/// shows that field in a &lt;pre&gt;, so both halves display as written: the sentence is what a
/// reviewer scanning a list reads, and the JSON below it is what someone reconstructing a change
/// actually needs. Splitting on the first blank line recovers the structured half.
/// </para>
/// </remarks>
public sealed record PermissionDiffDto(
    IReadOnlyList<PermissionChangeDto> Added,
    IReadOnlyList<PermissionChangeDto> Removed)
{
    public static readonly PermissionDiffDto Empty = new([], []);

    public bool IsEmpty => Added.Count == 0 && Removed.Count == 0;

    /// <summary>
    /// "3 permissions granted, 1 permission revoked" — or "no permission changes", which is worth
    /// saying explicitly. An edit that renamed a role without touching its grants is a materially
    /// different event from one that did, and a reviewer should not have to infer that from an absent
    /// clause.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Counts the direction ACCESS moved, per capability — not which list a row landed in. For a role
    /// grant the two coincide. For a per-user override they do not, and conflating them made the
    /// headline state a privilege change backwards: adding a <c>Revoke</c> override read
    /// "1 permission granted", and lifting one read "1 permission revoked".
    /// </para>
    /// <para>
    /// So each capability is judged once, by its state after the change: an override now present
    /// decides it by its own effect; one that is simply gone decides it by the opposite of what it
    /// used to do. Flipping an override from Grant to Revoke therefore counts as one revocation,
    /// not as a grant removed plus a revoke added.
    /// </para>
    /// <para>
    /// The direction is at the level of the thing edited. Lifting a Grant override is reported as a
    /// revocation even if the user's role happens to grant the same capability anyway — the audit
    /// row records the change that was made, not a recomputation of effective access.
    /// </para>
    /// </remarks>
    public string Summarise()
    {
        if (IsEmpty)
        {
            return "no permission changes";
        }

        // GroupBy rather than ToDictionary: a summary line must never be the thing that throws.
        var after = Added.GroupBy(c => (c.FeatureKey, c.Capability))
                         .ToDictionary(g => g.Key, g => IsRevoke(g.Last()));
        var granted = after.Count(kv => !kv.Value);
        var revoked = after.Count(kv => kv.Value);

        foreach (var gone in Removed.Where(c => !after.ContainsKey((c.FeatureKey, c.Capability)))
                                    .DistinctBy(c => (c.FeatureKey, c.Capability)))
        {
            if (IsRevoke(gone)) granted++;
            else revoked++;
        }

        var parts = new List<string>(2);
        if (granted > 0) parts.Add($"{granted} permission{(granted == 1 ? "" : "s")} granted");
        if (revoked > 0) parts.Add($"{revoked} permission{(revoked == 1 ? "" : "s")} revoked");
        return string.Join(", ", parts);

        static bool IsRevoke(PermissionChangeDto c) =>
            string.Equals(c.Effect, "Revoke", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// The full <c>Details</c> value: <paramref name="headline"/>, then a blank line, then the
    /// grants themselves as JSON. Returns the headline alone when nothing changed, so a no-op edit
    /// does not carry an empty JSON object for no reason.
    /// </summary>
    public string ToDetails(string headline)
    {
        if (IsEmpty)
        {
            return headline;
        }

        var payload = JsonSerializer.Serialize(
            new
            {
                added = Added.Select(c => c.ToString()).OrderBy(s => s, StringComparer.Ordinal).ToArray(),
                removed = Removed.Select(c => c.ToString()).OrderBy(s => s, StringComparer.Ordinal).ToArray(),
            },
            new JsonSerializerOptions { WriteIndented = true });

        var sb = new StringBuilder(headline);
        sb.AppendLine();
        sb.AppendLine();
        sb.Append(payload);
        return sb.ToString();
    }
}
