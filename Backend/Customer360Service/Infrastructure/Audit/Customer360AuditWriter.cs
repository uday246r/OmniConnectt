using System;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using backend.Data;
using backend.Infrastructure.Security;
using backend.Models;

namespace backend.Infrastructure.Audit;

/// <summary>
/// The one place this service records that something happened.
/// </summary>
/// <remarks>
/// <para>
/// It exists because the browser used to do this job. <c>POST /v1/audit</c> was authenticated but
/// otherwise unguarded: the client chose the action, the description, the customer and the outcome,
/// and the server wrote whatever it was handed. That produced a trail which was authoritative in
/// appearance and unverifiable in substance — a client could omit an action it would rather not
/// record, and every "viewed sensitive data" row asserted a browser-side toggle the server never saw.
/// </para>
/// <para>
/// Every write now originates from the endpoint that actually served the request, so a row exists
/// if and only if the work was really done, and the actor is the verified token's subject rather
/// than anything the caller typed.
/// </para>
/// <para>
/// Writes go to BOTH sinks, which is the same dual-write LeadService already performs: the local
/// <c>audit_logs</c> table backs this remote's own Audit Logs screen, and the push to AuthService
/// puts Customer360 activity into the platform-wide trail — which, before this, it was almost
/// entirely absent from (field-config edits were the only thing that ever reached it). The local
/// write is authoritative; the central push is best-effort and must never fail the request that
/// triggered it, because refusing a customer lookup over an audit-transport hiccup trades a real
/// outage for a bookkeeping one.
/// </para>
/// </remarks>
public class Customer360AuditWriter(
    AuditRepository repository,
    AuthServiceClient authServiceClient,
    IHttpContextAccessor httpContextAccessor,
    ILogger<Customer360AuditWriter> logger)
{
    /// <summary>Matches the <c>SourceApplication</c> AuthService stamps rows with, so the host's
    /// Audit Logs "Application" filter resolves this service to the name users see in the sidebar
    /// rather than to a class name.</summary>
    public const string SourceApplication = "Customer 360";

    /// <param name="action">
    /// This service's own vocabulary — <c>VIEW_PROFILE</c>, <c>SEARCH</c>, <c>UPDATE</c>,
    /// <c>EXPORT</c>. Deliberately NOT the platform's dotted keys: the remote's own Audit Logs
    /// screen filters on these values (and matches <c>VIEW%</c> as a prefix), and its existing
    /// history is written in them. Changing it would orphan every row already in the table.
    /// </param>
    /// <param name="centralAction">
    /// The platform key the same event is filed under in AuthService's sink — <c>customer360.*</c>,
    /// matching the dotted convention every other service uses there. Two vocabularies rather than
    /// one is a real cost, but the alternative is either breaking this remote's screen or putting a
    /// shape into the platform trail that nothing else there uses.
    /// </param>
    public async Task WriteAsync(
        string action,
        string centralAction,
        string description,
        string? customerName = null,
        string? customerType = null,
        string? customerId = null,
        string? field = null,
        string status = "Success",
        string module = "Customer 360",
        string? page = null,
        string actionCategory = "CRUD",
        CancellationToken ct = default)
    {
        var (actorId, actorName) = ResolveActor();

        var entry = new AuditLog
        {
            Id = Guid.NewGuid().ToString(),
            Timestamp = DateTimeOffset.UtcNow,
            User = actorName,
            UserId = actorId,
            Action = action,
            Description = description,
            Status = status,
            CustomerName = customerName,
            CustomerType = customerType,
            CustomerId = customerId,
            Field = field,
        };

        await repository.AddAsync(entry, ct);

        await authServiceClient.PushAuditLogAsync(
            action: centralAction,
            entityType: "Customer",
            entityId: customerId,
            details: description,
            actorUserId: actorId,
            actorName: actorName,
            entityLabel: customerName,
            sourceApplication: SourceApplication,
            module: module,
            page: page,
            actionCategory: actionCategory,
            result: status,
            ct: ct);
    }

    /// <summary>
    /// Records an attempt that did NOT succeed.
    ///
    /// Worth its own entry point rather than a <c>status</c> argument at every call site: the failure
    /// cases are the ones an audit trail exists for, and giving them a distinct method makes it
    /// visible in review when a code path records only its happy outcome.
    /// </summary>
    public Task WriteFailureAsync(
        string action, string centralAction, string description, string? customerId = null,
        string? customerName = null, string module = "Customer 360", string? page = null,
        string actionCategory = "CRUD", CancellationToken ct = default) =>
        WriteAsync(action, centralAction, description, customerName, customerType: null, customerId: customerId,
            field: null, status: "Failure", module: module, page: page, actionCategory: actionCategory, ct: ct);

    /// <summary>
    /// Who to attribute an entry to — read from the VERIFIED token and nowhere else.
    ///
    /// This previously preferred an "X-Staff-User" request header over the JWT, so any caller could
    /// attribute a fabricated entry to any colleague they cared to name. An audit trail whose actor
    /// is client-supplied is worse than no audit trail: it reads as authoritative while being
    /// trivially forgeable, and the fabricated rows are indistinguishable from real ones afterwards.
    ///
    /// The old "Admin User" catch-all is gone too — it silently mislabelled entries as an
    /// administrator's when no claim resolved. An unattributable entry now says so plainly.
    /// </summary>
    private (Guid? ActorId, string ActorName) ResolveActor()
    {
        var user = httpContextAccessor.HttpContext?.User;
        if (user is null)
        {
            // No inbound request at all — background work, or a unit test exercising the writer
            // directly. Naming that honestly beats inventing a person.
            logger.LogDebug("Audit write with no HttpContext; attributing to the service itself.");
            return (null, "System");
        }

        Guid? actorId = Guid.TryParse(user.FindFirst(JwtClaimTypes.Subject)?.Value, out var parsed) ? parsed : null;

        // Short claim names, not the long-form ClaimTypes.* URIs. Program.cs sets
        // `options.MapInboundClaims = false`, which stops the JWT handler remapping "name" and
        // "email" onto their legacy WS-Security URIs — so ClaimTypes.Name never matched anything and
        // EVERY audit row fell through to the subject id, rendering as
        // "User 60892301-eded-47ce-be0b-09a5823bc2bc" instead of the person's name.
        var nameClaim = user.FindFirst(JwtClaimTypes.Name)?.Value;
        if (!string.IsNullOrEmpty(nameClaim) && nameClaim != "omniconnect-app")
        {
            return (actorId, nameClaim);
        }

        var emailClaim = user.FindFirst(JwtClaimTypes.Email)?.Value;
        if (!string.IsNullOrEmpty(emailClaim))
        {
            return (actorId, emailClaim);
        }

        // The subject id is the last resort that is still genuinely the caller. Naming it as an id
        // rather than a person keeps the row honest about what is actually known.
        var subClaim = user.FindFirst(JwtClaimTypes.Subject)?.Value;
        return (actorId, !string.IsNullOrEmpty(subClaim) ? $"User {subClaim}" : "Unattributed");
    }
}
