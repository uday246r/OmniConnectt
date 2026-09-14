using System.Text;
using AuthService.Application.DTOs;
using AuthService.Application.Events;
using AuthService.Domain.Entities;
using AuthService.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace AuthService.Application.Services;

/// <summary>
/// The single sink every service's audit trail lands in. AuthService writes its own User/Role
/// mutations directly (in-process, see UserAppService/RoleAppService) — no HTTP round-trip needed
/// since it's the same process. Everyone else (LeadService, Customer360Service, any future remote's
/// backend) posts here via the internal API-key-protected endpoint. One table, one query, whether
/// the action happened in the host or a remote app.
/// </summary>
public class AuditLogAppService(AuthDbContext db, IPlatformEventPublisher events, IHttpContextAccessor httpContextAccessor)
{
    private const string CorrelationIdItemsKey = "Audit.CorrelationId";

    /// <summary>
    /// The id every audit row written during THIS request shares, unless a caller explicitly
    /// overrides it. Resolution order: an id already seeded or resolved earlier in this same request
    /// (cached on <c>HttpContext.Items</c>, so every call within one request agrees); otherwise an
    /// inbound <c>X-Correlation-Id</c> header, so a chain started by a remote keeps its own id;
    /// otherwise <c>HttpContext.TraceIdentifier</c>, already stable for the life of the request; and
    /// only a fresh GUID when there is no HttpContext at all (background work outside a request).
    ///
    /// Exposed (not just used internally by WriteAsync) so a multi-request chain — maker-checker is
    /// the one that exists today — can capture this once, at the point the chain begins, and store it
    /// somewhere longer-lived (ApprovalRequest.CorrelationId) to hand back via SeedCorrelationId on
    /// every later request in that same chain.
    /// </summary>
    public string ResolveCorrelationId()
    {
        var http = httpContextAccessor.HttpContext;
        if (http is null)
        {
            return Guid.NewGuid().ToString();
        }

        if (http.Items[CorrelationIdItemsKey] is string cached)
        {
            return cached;
        }

        var id = http.Request.Headers.TryGetValue("X-Correlation-Id", out var header) && !string.IsNullOrWhiteSpace(header)
            ? header.ToString()
            : http.TraceIdentifier;

        http.Items[CorrelationIdItemsKey] = id;
        if (!http.Response.HasStarted)
        {
            http.Response.Headers["X-Correlation-Id"] = id;
        }
        return id;
    }

    /// <summary>
    /// Forces every audit write for the REST of this request (however deep — a replayed mutation
    /// several call frames down included) to use <paramref name="correlationId"/> instead of the
    /// per-request default ResolveCorrelationId would otherwise compute. This is how the
    /// maker-checker flow keeps "approved" and the mutation it replays in the same thread as the
    /// original "requested": ApprovalAppService seeds the approval's own long-lived correlation id
    /// once, at the top of Approve/Reject, before calling into UserAppService/RoleAppService — which
    /// call WriteAsync with no correlationId of their own and so pick up the seeded value through
    /// ResolveCorrelationId's cache check, with no signature change needed on either service.
    /// No-op outside an HTTP request.
    /// </summary>
    public void SeedCorrelationId(string correlationId)
    {
        var http = httpContextAccessor.HttpContext;
        if (http is null) return;
        http.Items[CorrelationIdItemsKey] = correlationId;
    }

    /// <summary>
    /// Records something AuthService itself did, on behalf of a signed-in user of the host shell.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A convenience over <see cref="WriteAsync"/> that exists for one reason: every in-process
    /// writer used to omit <c>sourceApplication</c>, <c>module</c> and <c>actionCategory</c>. Those
    /// three are what the Audit Logs page's Application, Module and Category filters match on, and
    /// <c>HostOrRemote</c>/<c>RemoteName</c> are derived from the first of them — so every host
    /// mutation in the table carried nulls in all five columns, and selecting "Host" in the
    /// Application filter returned nothing at all while the rows sat there in plain view.
    /// </para>
    /// <para>
    /// Making them required parameters rather than optional ones is the point. A new host writer
    /// cannot silently reintroduce the gap; it has to say which module it belongs to and what kind
    /// of action it is.
    /// </para>
    /// </remarks>
    public Task WriteHostAsync(
        Guid? actorUserId, string? actorName, string action, string module, string actionCategory,
        string? entityType = null, string? entityId = null, string? details = null,
        string? entityLabel = null, string? sourceIp = null, string? userAgent = null,
        string result = "Success", string? failureReason = null, string? authMethod = null,
        string? correlationId = null, string? page = null, CancellationToken ct = default) =>
        WriteAsync(
            HostServiceName, actorUserId, actorName, action, entityType, entityId, details,
            sourceIp: sourceIp, authMethod: authMethod, result: result, userAgent: userAgent,
            failureReason: failureReason, correlationId: correlationId, entityLabel: entityLabel,
            sourceApplication: HostApplicationName, module: module, page: page,
            actionCategory: actionCategory, ct: ct);

    /// <summary>The <c>ServiceName</c> AuthService stamps its own rows with.</summary>
    public const string HostServiceName = "AuthService";

    /// <summary>
    /// The <c>SourceApplication</c> for anything done in the shell. Matches the literal
    /// <see cref="Domain.Entities.AuditLog.HostOrRemote"/> derivation below — change one and the
    /// other stops recognising host rows.
    /// </summary>
    public const string HostApplicationName = "Host";

    /// <summary>
    /// The <c>ActionCategory</c> vocabulary. A closed set by convention rather than an enum, because
    /// remote services write into the same column over HTTP and cannot share a CLR type; these
    /// constants keep the host's half of it from drifting into synonyms.
    /// </summary>
    public static class Categories
    {
        public const string Auth = "Auth";
        public const string Authorization = "Authorization";
        public const string Crud = "CRUD";
        public const string Approval = "Approval";
        public const string Export = "Export";
        public const string Configuration = "Configuration";
    }

    /// <summary>The <c>Module</c> vocabulary for host-originated rows — the functional areas the
    /// sidebar and the Role editor already divide the shell into.</summary>
    public static class Modules
    {
        public const string Authentication = "Authentication";
        public const string Users = "Users";
        public const string Roles = "Roles";
        public const string Applications = "Applications";
        public const string Approvals = "Approvals";
        public const string CheckerAssignment = "Checker Assignment";
        public const string AuditLogs = "Audit Logs";
        public const string SystemLogs = "System Logs";
        public const string UserSchema = "User Schema";
    }

    public async Task WriteAsync(
        string serviceName, Guid? actorUserId, string? actorName, string action,
        string? entityType, string? entityId, string? details, string? sourceIp = null,
        string? authMethod = null, string result = "Success", string? userAgent = null,
        string? failureReason = null, string? correlationId = null, string? entityLabel = null,
        string? sourceApplication = null, string? module = null, string? page = null, string? actionCategory = null,
        CancellationToken ct = default)
    {
        db.AuditLogs.Add(new AuditLog
        {
            Id = Guid.NewGuid(),
            OccurredAt = DateTimeOffset.UtcNow,
            ServiceName = serviceName,
            ActorUserId = actorUserId,
            ActorName = actorName,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            EntityLabel = entityLabel,
            Details = details,
            SourceIp = sourceIp,
            AuthMethod = authMethod,
            Result = result,
            UserAgent = userAgent,
            FailureReason = failureReason,
            CorrelationId = correlationId ?? ResolveCorrelationId(),
            SourceApplication = sourceApplication,
            HostOrRemote = sourceApplication != null ? (sourceApplication == "Host" ? "Host" : "Remote") : null,
            RemoteName = sourceApplication != null && sourceApplication != "Host" ? sourceApplication : null,
            Module = module,
            Page = page,
            ActionCategory = actionCategory
        });
        await db.SaveChangesAsync(ct);

        await events.PublishToAuditViewersAsync(new PlatformEvent("audit-logs", action), ct);
        events.RequestKpiRefresh();
    }

    public async Task<PagedResult<AuditLogDto>> ListAsync(
        int page, int pageSize, AuditLogFilter filter, string? sortDir = null, CancellationToken ct = default)
    {
        var query = BuildFilteredQuery(filter);

        var total = await query.CountAsync(ct);
        var ordered = string.Equals(sortDir, "asc", StringComparison.OrdinalIgnoreCase)
            ? query.OrderBy(a => a.OccurredAt).ThenBy(a => a.Id)
            : query.OrderByDescending(a => a.OccurredAt).ThenByDescending(a => a.Id);

        var items = await ordered
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(a => ToDto(a))
            .ToListAsync(ct);

        return new PagedResult<AuditLogDto>(items, total, page, pageSize);
    }

    /// <summary>
    /// Real aggregate counts over the SAME filtered set the table is showing — never derived
    /// client-side from a partial page of rows.
    /// </summary>
    /// <remarks>
    /// Takes the whole filter, not just the date range. It previously took only from/to, so the
    /// summary cards above the table counted the entire date range while the table below them showed
    /// one service, or one actor — two numbers describing different populations, side by side, with
    /// nothing on screen saying so.
    /// </remarks>
    public async Task<AuditLogSummaryDto> SummaryAsync(AuditLogFilter filter, CancellationToken ct = default)
    {
        var query = BuildFilteredQuery(filter);

        var loginSuccesses = await query.CountAsync(a => a.Action == "auth.login_succeeded", ct);
        var loginErrors = await query.CountAsync(a => a.Action == "auth.login_failed", ct);
        var totalAuditEvents = await query.CountAsync(ct);
        var activeUsers = await query
            .Where(a => a.ActorUserId != null)
            .Select(a => a.ActorUserId)
            .Distinct()
            .CountAsync(ct);

        return new AuditLogSummaryDto(loginSuccesses, loginErrors, totalAuditEvents, activeUsers);
    }

    /// <summary>
    /// The values each bounded filter can usefully take, given the other filters already applied.
    /// </summary>
    /// <remarks>
    /// Each list is capped. Without that, a column which turned out to be higher-cardinality than
    /// expected would return the whole table through what looks like a cheap dropdown query.
    /// </remarks>
    public async Task<AuditLogFacetsDto> FacetsAsync(AuditLogFilter filter, CancellationToken ct = default)
    {
        const int maxOptions = 200;
        var query = BuildFilteredQuery(filter);

        var services = await query
            .Select(a => a.SourceApplication ?? a.ServiceName)
            .Distinct().OrderBy(s => s).Take(maxOptions).ToListAsync(ct);

        // Grouped into an anonymous type and mapped afterwards, rather than projected straight into
        // the record. A constructor call wrapping an aggregate is not translatable by every provider,
        // and the grouping itself is what has to run in the database — the mapping is free.
        var actionCounts = await query
            .GroupBy(a => a.Action)
            .Select(g => new { Action = g.Key, Count = g.Count() })
            .OrderBy(g => g.Action).Take(maxOptions).ToListAsync(ct);
        var actions = actionCounts.Select(g => new AuditActionFacet(g.Action, g.Count)).ToList();

        var authMethods = await DistinctNonNull(query.Select(a => a.AuthMethod), maxOptions, ct);
        var modules = await DistinctNonNull(query.Select(a => a.Module), maxOptions, ct);
        var pages = await DistinctNonNull(query.Select(a => a.Page), maxOptions, ct);
        var categories = await DistinctNonNull(query.Select(a => a.ActionCategory), maxOptions, ct);

        return new AuditLogFacetsDto(services, actions, authMethods, modules, pages, categories);
    }

    private static Task<List<string>> DistinctNonNull(IQueryable<string?> values, int take, CancellationToken ct) =>
        values.Where(v => v != null).Select(v => v!).Distinct().OrderBy(v => v).Take(take).ToListAsync(ct);

    /// <summary>
    /// CSV of the current filtered result set, capped — and reporting that it capped.
    /// </summary>
    /// <remarks>
    /// Takes the identical <see cref="AuditLogFilter"/> the list takes, which is the entire point of
    /// that type existing. The two used to accept different filter sets, and the export silently
    /// ignored the one the User detail page depended on.
    /// </remarks>
    public async Task<CsvExport> ExportCsvAsync(
        AuditLogFilter filter, string? sortDir = null, CancellationToken ct = default)
    {
        const int maxRows = 10_000;
        var query = BuildFilteredQuery(filter);

        // A second query rather than an inference from the row count, because "did this hit the cap"
        // and "how much did it miss" are different questions, and the operator needs the second one
        // to decide how much further to narrow the range.
        var matched = await query.CountAsync(ct);

        var ordered = string.Equals(sortDir, "asc", StringComparison.OrdinalIgnoreCase)
            ? query.OrderBy(a => a.OccurredAt)
            : query.OrderByDescending(a => a.OccurredAt);

        var items = await ordered.Take(maxRows).ToListAsync(ct);

        var csv = new CsvBuilder(
            "Time", "Service", "Actor", "Action", "Result", "AuthMethod", "EntityType", "EntityLabel",
            "EntityId", "SourceIp", "UserAgent", "FailureReason", "Details", "SourceApplication",
            "Module", "Page", "ActionCategory");

        foreach (var a in items)
        {
            csv.AppendRow(
                a.OccurredAt.ToString("O"), a.ServiceName, a.ActorName, a.Action, a.Result,
                a.AuthMethod, a.EntityType, a.EntityLabel, a.EntityId, a.SourceIp, a.UserAgent,
                a.FailureReason, a.Details, a.SourceApplication, a.Module, a.Page, a.ActionCategory);
        }

        // CorrelationId is deliberately absent from the columns. It is an internal request identifier
        // that means nothing outside this platform, and putting it in a file that leaves invites
        // someone to treat it as a business key.
        return new CsvExport(csv.ToString(), items.Count, matched, maxRows);
    }

    private IQueryable<AuditLog> BuildFilteredQuery(AuditLogFilter f)
    {
        var query = db.AuditLogs.AsNoTracking().AsQueryable();

        if (f.ActorUserId is not null)
        {
            query = query.Where(a => a.ActorUserId == f.ActorUserId);
        }

        if (!string.IsNullOrWhiteSpace(f.CorrelationId))
        {
            query = query.Where(a => a.CorrelationId == f.CorrelationId);
        }

        if (!string.IsNullOrWhiteSpace(f.Service))
        {
            query = query.Where(a => a.ServiceName == f.Service || a.SourceApplication == f.Service);
        }

        if (!string.IsNullOrWhiteSpace(f.Action))
        {
            query = query.Where(a => a.Action.Contains(f.Action));
        }

        if (!string.IsNullOrWhiteSpace(f.Result))
        {
            query = query.Where(a => a.Result == f.Result);
        }

        if (f.From is not null)
        {
            query = query.Where(a => a.OccurredAt >= f.From);
        }

        if (f.To is not null)
        {
            query = query.Where(a => a.OccurredAt <= f.To);
        }

        if (!string.IsNullOrWhiteSpace(f.ActorName))
        {
            query = query.Where(a =>
                (a.ActorName != null && a.ActorName.Contains(f.ActorName))
                || (a.ActorUserId != null && a.ActorUserId.ToString() == f.ActorName));
        }

        if (!string.IsNullOrWhiteSpace(f.EntityType))
        {
            query = query.Where(a => a.EntityType != null && a.EntityType.Contains(f.EntityType));
        }

        if (!string.IsNullOrWhiteSpace(f.EntityId))
        {
            // Matches every column the Record cell can display, because the filter has to match what
            // is on screen — and which of these is populated varies by action.
            query = query.Where(a =>
                (a.EntityId != null && a.EntityId.Contains(f.EntityId))
                || (a.EntityLabel != null && a.EntityLabel.Contains(f.EntityId))
                || (a.EntityType != null && a.EntityType.Contains(f.EntityId)));
        }

        if (!string.IsNullOrWhiteSpace(f.SourceApplication))
        {
            query = query.Where(a => a.SourceApplication == f.SourceApplication);
        }

        if (!string.IsNullOrWhiteSpace(f.Module))
        {
            query = query.Where(a => a.Module == f.Module);
        }

        if (!string.IsNullOrWhiteSpace(f.PageName))
        {
            query = query.Where(a => a.Page == f.PageName);
        }

        if (!string.IsNullOrWhiteSpace(f.ActionCategory))
        {
            query = query.Where(a => a.ActionCategory == f.ActionCategory);
        }

        if (!string.IsNullOrWhiteSpace(f.AuthMethod))
        {
            query = query.Where(a => a.AuthMethod == f.AuthMethod);
        }

        if (!string.IsNullOrWhiteSpace(f.SourceIp))
        {
            query = query.Where(a => a.SourceIp != null && a.SourceIp.Contains(f.SourceIp));
        }

        if (!string.IsNullOrWhiteSpace(f.Device))
        {
            /*
             * A display name ("macOS", "Edge") expanded into the raw substrings that produce it, then
             * OR-ed into the query as a chain of Contains. EF cannot translate a call to a helper
             * method, so the expansion happens here rather than inside UserAgentMatcher.
             *
             * Edge is subtracted from Chrome for the same reason the frontend parser checks Edg/
             * before Chrome/: every Edge User-Agent also contains "Chrome", so without this an
             * operator filtering to Chrome would be shown every Edge session as well.
             */
            var needles = Infrastructure.Security.UserAgentMatcher.SubstringsFor(f.Device);

            // An explicit OR chain, not `needles.Any(n => ua.Contains(n))`. The latter reads better
            // and is not translatable: a closure collection iterated against a column has no SQL
            // form, and providers reject it outright rather than falling back to client evaluation.
            // The list is never longer than two entries, so the chain stays short.
            var predicate = OrOfContains(needles);
            query = query.Where(predicate);

            if (f.Device.Equals("Chrome", StringComparison.OrdinalIgnoreCase))
            {
                query = query.Where(a => !a.UserAgent!.Contains("Edg/"));
            }
        }

        return query;
    }

    /// <summary>
    /// "UserAgent contains needle[0] OR contains needle[1] OR …", built as an expression tree so the
    /// provider can translate it. Matches nothing when the list is empty, which is the safe direction
    /// for a filter — an unrecognised device name narrows to zero rows rather than silently widening
    /// to all of them.
    /// </summary>
    private static System.Linq.Expressions.Expression<Func<AuditLog, bool>> OrOfContains(IReadOnlyList<string> needles)
    {
        var parameter = System.Linq.Expressions.Expression.Parameter(typeof(AuditLog), "a");
        var userAgent = System.Linq.Expressions.Expression.Property(parameter, nameof(AuditLog.UserAgent));
        var containsMethod = typeof(string).GetMethod(nameof(string.Contains), [typeof(string)])!;

        System.Linq.Expressions.Expression body = System.Linq.Expressions.Expression.Constant(false);
        foreach (var needle in needles)
        {
            var contains = System.Linq.Expressions.Expression.Call(
                userAgent, containsMethod, System.Linq.Expressions.Expression.Constant(needle));
            body = System.Linq.Expressions.Expression.OrElse(body, contains);
        }

        // The null guard wraps the whole chain rather than each term — UserAgent is nullable, and
        // calling Contains on it unguarded is a null reference the moment a row has none.
        var notNull = System.Linq.Expressions.Expression.NotEqual(
            userAgent, System.Linq.Expressions.Expression.Constant(null, typeof(string)));

        return System.Linq.Expressions.Expression.Lambda<Func<AuditLog, bool>>(
            System.Linq.Expressions.Expression.AndAlso(notNull, body), parameter);
    }

    private static AuditLogDto ToDto(AuditLog a) => new(
        a.Id, a.OccurredAt, a.ServiceName, a.ActorUserId, a.ActorName, a.Action, a.EntityType, a.EntityId, a.EntityLabel,
        a.Details, a.SourceIp, a.AuthMethod, a.Result, a.UserAgent, a.FailureReason, a.CorrelationId,
        a.SourceApplication, a.Module, a.Page, a.ActionCategory);
}
