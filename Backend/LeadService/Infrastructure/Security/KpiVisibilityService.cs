using System.Security.Claims;
using LeadManagement.Api.Models.Dtos;

namespace LeadManagement.Api.Infrastructure.Security;

/// <summary>
/// Removes from the KPI summary the cards its caller was not granted.
/// </summary>
/// <remarks>
/// <para>
/// Most fine-grained capabilities guard a whole endpoint and are enforced by
/// <see cref="RequiresFineCapabilityAttribute"/> before the handler runs. Three of the KPI cards
/// cannot be: Total Leads, New Leads and Converted are computed together in one pass and returned in
/// one object, so there is no separate request to refuse. Splitting them into three endpoints purely
/// to make them attribute-guardable would triple the cost of a page that always wants all three.
/// </para>
/// <para>
/// Redacting the response is the same guarantee arrived at differently. A caller who was not granted
/// a card gets null where its number would be, whether they asked through the dashboard or with curl.
/// The gap this closes is the one where the UI hides a card and the endpoint hands the number over
/// anyway.
/// </para>
/// <para>
/// Nullable, not zero. A withheld card and a card that legitimately reads zero are different facts,
/// and returning 0 would quietly state something false about the business.
/// </para>
/// </remarks>
public class KpiVisibilityService(FineCapabilityClient capabilities)
{
    /// <summary>The three cards that share one response, paired with the capability each needs.</summary>
    private static readonly (string Capability, Action<KpiSummaryDto> Redact)[] Cards =
    [
        ("kpi.total-leads", d => { d.TotalLeads = null; d.TotalLeadsTrend.Clear(); }),
        ("kpi.new-leads", d => { d.NewLeads = null; d.NewLeadsTrend.Clear(); }),
        ("kpi.converted", d => { d.ConvertedLeads = null; d.ConvertedLeadsTrend.Clear(); }),
    ];

    public async Task RedactAsync(KpiSummaryDto summary, ClaimsPrincipal user, CancellationToken ct = default)
    {
        if (user.FindFirst(JwtClaimTypes.Administrator)?.Value == "true")
        {
            return;
        }

        if (!Guid.TryParse(user.FindFirst(JwtClaimTypes.Subject)?.Value, out var userId))
        {
            // No usable subject means nothing can be resolved, and the fail-closed answer is to show
            // no cards rather than all of them.
            foreach (var card in Cards)
            {
                card.Redact(summary);
            }
            return;
        }

        var held = await capabilities.GetForUserAsync(userId, ct);

        foreach (var card in Cards)
        {
            var required = $"{RequiresCapabilityAttribute.FeatureKey}.dashboard:{card.Capability}";
            if (!held.Contains(required, StringComparer.OrdinalIgnoreCase))
            {
                card.Redact(summary);
            }
        }
    }
}
