namespace AuthService.Application.DTOs;

/// <summary>
/// Everything an audit query can be narrowed by — one shape, used by the list, the summary, the
/// facets and the export alike.
/// </summary>
/// <remarks>
/// <para>
/// It is a record rather than a parameter list because the parameter lists had already drifted
/// apart, and drifted in a way that produced a real defect. <c>ListAsync</c> accepted
/// <see cref="ActorUserId"/>; <c>ExportCsvAsync</c> did not, though it accepted three filters the
/// list lacked. Both funnelled into one query builder that supported the union of the two, so the
/// gap was invisible in the service and only surfaced at the controller: the User detail page's
/// "export this user's activity" button sent <c>actorUserId</c>, the export endpoint had no
/// parameter to bind it to, the value was dropped, and the operator was handed the entire platform's
/// audit trail under a success toast.
/// </para>
/// <para>
/// With one record the asymmetry is not merely fixed but unrepresentable: adding a filter adds it to
/// every consumer at once, and a consumer that ignores one fails to compile rather than silently
/// widening its result set.
/// </para>
/// </remarks>
public sealed record AuditLogFilter
{
    /// <summary>Matches either the recording service or the application it came from, since the two
    /// name the same thing differently ("LeadService" / "Lead Management") and an operator picking
    /// from a list should not have to know which.</summary>
    public string? Service { get; init; }

    /// <summary>Substring, because action keys are hierarchical ("auth.login_failed") and filtering
    /// to a family is as useful as filtering to one key.</summary>
    public string? Action { get; init; }

    /// <summary>"Success" or "Failure".</summary>
    public string? Result { get; init; }

    public DateTimeOffset? From { get; init; }
    public DateTimeOffset? To { get; init; }

    /// <summary>Exact actor. This is the one the export used to drop.</summary>
    public Guid? ActorUserId { get; init; }

    /// <summary>Actor by name, or by id typed as text — a free-text box where an operator may paste
    /// either.</summary>
    public string? ActorName { get; init; }

    public string? CorrelationId { get; init; }
    public string? EntityType { get; init; }

    /// <summary>Matches the id, the human label or the type, because the Record column on screen
    /// shows whichever of those is present and the filter must match what is visible.</summary>
    public string? EntityId { get; init; }

    public string? SourceApplication { get; init; }
    public string? Module { get; init; }
    public string? PageName { get; init; }
    public string? ActionCategory { get; init; }

    /// <summary>"Local" or "Google". Filtered client-side until now, which is why an export could
    /// never honour it.</summary>
    public string? AuthMethod { get; init; }

    /// <summary>Substring of the recorded address. Substring rather than exact so a search for
    /// "10.0.0.1" also finds "::ffff:10.0.0.1", which is how a dual-stack listener records it.</summary>
    public string? SourceIp { get; init; }

    /// <summary>A browser or OS name as the detail drawer displays it — see
    /// <see cref="AuthService.Infrastructure.Security.UserAgentMatcher"/> for why this cannot be a
    /// plain substring match against the raw header.</summary>
    public string? Device { get; init; }
}

/// <summary>
/// The distinct values available for each low-cardinality filter, under the OTHER filters currently
/// applied.
/// </summary>
/// <remarks>
/// The Audit Logs page used to build these lists from whatever rows it had fetched, which had two
/// consequences. With genuine server-side paging a ten-row page would offer a ten-value dropdown;
/// and even with a large pre-fetch the options ignored the other active filters, so the Action list
/// offered actions that no longer existed under the chosen Service. Deriving them from the same
/// filtered query the table uses fixes both.
///
/// Only bounded columns appear here. Actor, record, IP and device are unbounded — a DISTINCT over
/// actor names or addresses is a full scan — and stay free-text with suggestions drawn from the
/// current page.
/// </remarks>
public sealed record AuditLogFacetsDto(
    IReadOnlyList<string> Services,
    IReadOnlyList<AuditActionFacet> Actions,
    IReadOnlyList<string> AuthMethods,
    IReadOnlyList<string> Modules,
    IReadOnlyList<string> Pages,
    IReadOnlyList<string> ActionCategories);

/// <param name="Count">Carried so the UI can keep disambiguating labels that collide — two features
/// both offering "Created" render as "Created (User)" and "Created (Role)".</param>
public sealed record AuditActionFacet(string Action, int Count);
