using System;
using System.Collections.Generic;

namespace backend.Models
{
    /// <summary>
    /// Everything the Customer 360 audit trail can be narrowed by — one shape for the list, the count
    /// and the export.
    /// </summary>
    /// <remarks>
    /// Status, actor, customer and description were filtered in the browser over the page already
    /// fetched, because <c>GET /v1/audit</c> accepted only <c>search</c> and <c>action</c>. Paging
    /// stayed server-side, so matches on other pages were unreachable, the pager had to be switched
    /// off whenever one of those filters was on, and the export — which could only send what the
    /// server understood — ignored all four. One record, bound once and passed to every consumer,
    /// keeps the screen and its CSV answering the same question.
    /// </remarks>
    public sealed record AuditQuery
    {
        /// <summary>Case-insensitive substring of the user, description or status.</summary>
        public string? Search { get; init; }

        /// <summary>An action code; "VIEW" matches every action beginning with VIEW.</summary>
        public string? Action { get; init; }

        public DateTimeOffset? From { get; init; }
        public DateTimeOffset? To { get; init; }

        /// <summary>
        /// "SUCCESS" or "FAILED". Anything not recorded as a success counts as a failure, matching the
        /// screen's own two-way reading of the column.
        /// </summary>
        public string? Status { get; init; }

        /// <summary>
        /// Case-insensitive substring of the stored actor, or an exact match on the actor's id. Rows
        /// written before the actor name was fixed hold "User &lt;id&gt;", so they are found by that id.
        /// </summary>
        public string? Actor { get; init; }

        /// <summary>Case-insensitive substring of the customer's name or id.</summary>
        public string? Customer { get; init; }

        /// <summary>Case-insensitive substring of the description alone.</summary>
        public string? Description { get; init; }

        /// <summary>The filters, for the export's audit row. Names only what was set.</summary>
        public string Describe()
        {
            var parts = new List<string>();
            if (!string.IsNullOrWhiteSpace(Search)) parts.Add($"search='{Search}'");
            if (!string.IsNullOrWhiteSpace(Action)) parts.Add($"action={Action}");
            if (!string.IsNullOrWhiteSpace(Status)) parts.Add($"status={Status}");
            if (!string.IsNullOrWhiteSpace(Actor)) parts.Add($"actor='{Actor}'");
            if (!string.IsNullOrWhiteSpace(Customer)) parts.Add($"customer='{Customer}'");
            if (!string.IsNullOrWhiteSpace(Description)) parts.Add($"description='{Description}'");
            if (From is not null) parts.Add($"from={From:O}");
            if (To is not null) parts.Add($"to={To:O}");
            return parts.Count == 0 ? "none (whole trail)" : string.Join(", ", parts);
        }
    }
}
