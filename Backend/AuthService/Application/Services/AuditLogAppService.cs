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
/// since it's the same process. Everyone else (ModuleRegistry, EmployeeService, any future remote's
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

    public async Task WriteAsync(
        string serviceName, Guid? actorUserId, string? actorName, string action,
        string? entityType, string? entityId, string? details, string? sourceIp = null,
        string? authMethod = null, string result = "Success", string? userAgent = null,
        string? failureReason = null, string? correlationId = null, string? entityLabel = null,
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
        });
        await db.SaveChangesAsync(ct);

        await events.PublishToAuditViewersAsync(new PlatformEvent("audit-logs", action), ct);
        events.RequestKpiRefresh();
    }

    public async Task<PagedResult<AuditLogDto>> ListAsync(
        int page, int pageSize, string? service, string? action, string? result,
        DateTimeOffset? from, DateTimeOffset? to, string? sortDir, Guid? actorUserId = null,
        string? correlationId = null, CancellationToken ct = default)
    {
        var query = BuildFilteredQuery(service, action, result, from, to, actorUserId, correlationId);

        var total = await query.CountAsync(ct);
        var ordered = string.Equals(sortDir, "asc", StringComparison.OrdinalIgnoreCase)
            ? query.OrderBy(a => a.OccurredAt)
            : query.OrderByDescending(a => a.OccurredAt);

        var items = await ordered
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(a => ToDto(a))
            .ToListAsync(ct);

        return new PagedResult<AuditLogDto>(items, total, page, pageSize);
    }

    /// <summary>Real aggregate counts over the given date range — never derived client-side from a partial page of rows.</summary>
    public async Task<AuditLogSummaryDto> SummaryAsync(DateTimeOffset? from, DateTimeOffset? to, CancellationToken ct = default)
    {
        var query = BuildFilteredQuery(null, null, null, from, to);

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

    /// <summary>CSV of the current filtered result set, capped at a sane row count so a huge unfiltered export can't lock up the request.</summary>
    public async Task<string> ExportCsvAsync(
        string? service, string? action, string? result, DateTimeOffset? from, DateTimeOffset? to, CancellationToken ct = default)
    {
        const int maxRows = 10_000;
        var items = await BuildFilteredQuery(service, action, result, from, to)
            .OrderByDescending(a => a.OccurredAt)
            .Take(maxRows)
            .ToListAsync(ct);

        var sb = new StringBuilder();
        sb.AppendLine("Time,Service,Actor,Action,Result,AuthMethod,EntityType,EntityLabel,EntityId,SourceIp,UserAgent,FailureReason,CorrelationId,Details");
        foreach (var a in items)
        {
            sb.AppendLine(string.Join(",", new[]
            {
                CsvField(a.OccurredAt.ToString("O")),
                CsvField(a.ServiceName),
                CsvField(a.ActorName),
                CsvField(a.Action),
                CsvField(a.Result),
                CsvField(a.AuthMethod),
                CsvField(a.EntityType),
                CsvField(a.EntityLabel),
                CsvField(a.EntityId),
                CsvField(a.SourceIp),
                CsvField(a.UserAgent),
                CsvField(a.FailureReason),
                CsvField(a.CorrelationId),
                CsvField(a.Details),
            }));
        }

        return sb.ToString();
    }

    private IQueryable<AuditLog> BuildFilteredQuery(string? service, string? action, string? result, DateTimeOffset? from, DateTimeOffset? to, Guid? actorUserId = null, string? correlationId = null)
    {
        var query = db.AuditLogs.AsNoTracking().AsQueryable();

        if (actorUserId is not null)
        {
            query = query.Where(a => a.ActorUserId == actorUserId);
        }

        if (!string.IsNullOrWhiteSpace(correlationId))
        {
            query = query.Where(a => a.CorrelationId == correlationId);
        }

        if (!string.IsNullOrWhiteSpace(service))
        {
            query = query.Where(a => a.ServiceName == service);
        }

        if (!string.IsNullOrWhiteSpace(action))
        {
            query = query.Where(a => a.Action.Contains(action));
        }

        if (!string.IsNullOrWhiteSpace(result))
        {
            query = query.Where(a => a.Result == result);
        }

        if (from is not null)
        {
            query = query.Where(a => a.OccurredAt >= from);
        }

        if (to is not null)
        {
            query = query.Where(a => a.OccurredAt <= to);
        }

        return query;
    }

    private static string CsvField(string? value)
    {
        var text = value ?? string.Empty;
        return text.Contains(',') || text.Contains('"') || text.Contains('\n')
            ? $"\"{text.Replace("\"", "\"\"")}\""
            : text;
    }

    private static AuditLogDto ToDto(AuditLog a) => new(
        a.Id, a.OccurredAt, a.ServiceName, a.ActorUserId, a.ActorName, a.Action, a.EntityType, a.EntityId, a.EntityLabel,
        a.Details, a.SourceIp, a.AuthMethod, a.Result, a.UserAgent, a.FailureReason, a.CorrelationId);
}
