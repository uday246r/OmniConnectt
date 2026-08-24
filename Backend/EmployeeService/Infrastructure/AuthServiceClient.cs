using System.Net.Http.Json;
using Microsoft.Extensions.Options;
using EmployeeService.Options;

namespace EmployeeService.Infrastructure;

/// <summary>
/// Pushes this service's own audit-log entries into AuthService's central AuditLogs table — same
/// shared static X-Internal-Api-Key trust boundary ModuleRegistry uses for its internal calls. A
/// transient AuthService outage never blocks an employee mutation: failures are logged, not thrown.
/// </summary>
public class AuthServiceClient(HttpClient httpClient, IOptions<AuthIntegrationOptions> options, ILogger<AuthServiceClient> logger, IHttpContextAccessor httpContextAccessor)
{
    private readonly AuthIntegrationOptions _options = options.Value;

    private record RecordAuditLogRequest(
        string ServiceName, Guid? ActorUserId, string? ActorName, string Action, string? EntityType, string? EntityId, string? Details,
        string? EntityLabel, string? SourceIp, string? UserAgent);

    private record SubmitInternalApprovalRequest(
        string Module, string Action, string? EntityType, string? EntityId, string? EntityLabel,
        string? OldDataJson, string NewDataJson, Guid MakerId, string SourceService, string CallbackUrl, string? CorrelationId,
        // Dedupe key for the one-open-request-per-record rule. Null is correct when EntityId exists;
        // Create MUST supply one, since a null key defeats the partial unique index (Postgres treats
        // NULLs as distinct) and lets the same record be submitted for approval twice.
        string? EntityKey = null);

    /// <summary>
    /// Is this module under Maker-Checker? Answered by AuthService, which owns checker assignments.
    ///
    /// A failure here returns FALSE — ungated — which is safe only because the caller treats a failed
    /// SUBMIT as an error. If the gate check wrongly says "not gated" the mutation applies directly,
    /// exactly as it did before approvals existed; the dangerous direction is a failed submit
    /// silently applying anyway, and that is what SubmitApprovalAsync refuses to do.
    /// </summary>
    public async Task<bool> IsGatedAsync(string module, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_options.BaseUrl) || string.IsNullOrWhiteSpace(module))
        {
            return false;
        }

        try
        {
            using var request = new HttpRequestMessage(
                HttpMethod.Get, $"{_options.BaseUrl.TrimEnd('/')}/internal/approvals/gated/{Uri.EscapeDataString(module)}");
            request.Headers.Add("X-Internal-Api-Key", _options.InternalApiKey);

            var response = await httpClient.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                return false;
            }

            var payload = await response.Content.ReadFromJsonAsync<GatedResponse>(cancellationToken: ct);
            return payload?.Gated ?? false;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not determine whether module '{Module}' is gated; treating as ungated.", module);
            return false;
        }
    }

    private record GatedResponse(bool Gated);

    /// <summary>
    /// Records a gated mutation as an approval request. Throws rather than returning a failure: a
    /// submission that cannot be recorded must never fall through to applying the change, or an
    /// AuthService outage becomes a way to bypass approval entirely.
    /// </summary>
    public async Task<DTOs.ApprovalPendingDto> SubmitApprovalAsync(
        string module, string action, string? entityType, string? entityId, string? entityLabel,
        string? oldDataJson, string newDataJson, Guid makerId, string callbackUrl, string correlationId,
        CancellationToken ct = default, string? entityKey = null)
    {
        if (string.IsNullOrWhiteSpace(_options.BaseUrl))
        {
            throw new DTOs.ApprovalServiceUnavailableException(
                "AuthService__BaseUrl is not configured — cannot submit this action for approval.");
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, $"{_options.BaseUrl.TrimEnd('/')}/internal/approvals/submit")
            {
                Content = JsonContent.Create(new SubmitInternalApprovalRequest(
                    module, action, entityType, entityId, entityLabel, oldDataJson, newDataJson, makerId,
                    "EmployeeService", callbackUrl, correlationId, entityKey)),
            };
            request.Headers.Add("X-Internal-Api-Key", _options.InternalApiKey);

            var response = await httpClient.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync(ct);
                throw new DTOs.ApprovalServiceUnavailableException(
                    $"AuthService rejected the approval submission: {response.StatusCode} {body}");
            }

            return await response.Content.ReadFromJsonAsync<DTOs.ApprovalPendingDto>(cancellationToken: ct)
                ?? throw new DTOs.ApprovalServiceUnavailableException(
                    "AuthService returned an empty response for the approval submission.");
        }
        catch (Exception ex) when (ex is not DTOs.ApprovalServiceUnavailableException)
        {
            throw new DTOs.ApprovalServiceUnavailableException(
                $"Could not reach AuthService to submit this action for approval: {ex.Message}");
        }
    }

    // sourceIp/userAgent come off THIS service's own current HttpContext — the real end user's
    // browser talks to EmployeeService directly, so this is where that information actually is;
    // AuthService's own connection for the internal POST below would just be this server's address.
    public Task<bool> PushAuditLogAsync(string action, string? entityType, string? entityId, string? details, Guid? actorUserId, string? actorName, string? entityLabel = null, CancellationToken ct = default)
    {
        var httpContext = httpContextAccessor.HttpContext;
        var sourceIp = httpContext?.Connection.RemoteIpAddress?.ToString();
        var userAgent = httpContext?.Request.Headers.UserAgent.ToString();
        return PostAsync("internal/audit-logs", new RecordAuditLogRequest("EmployeeService", actorUserId, actorName, action, entityType, entityId, details, entityLabel, sourceIp, userAgent), ct);
    }

    private async Task<bool> PostAsync<TBody>(string path, TBody body, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(_options.BaseUrl))
        {
            logger.LogWarning("AuthService__BaseUrl is not configured — skipping call to {Path}.", path);
            return false;
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, $"{_options.BaseUrl.TrimEnd('/')}/{path}")
            {
                Content = JsonContent.Create(body),
            };
            request.Headers.Add("X-Internal-Api-Key", _options.InternalApiKey);

            var response = await httpClient.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("AuthService rejected call to {Path}: {StatusCode}.", path, response.StatusCode);
                return false;
            }

            return true;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to reach AuthService for call to {Path}.", path);
            return false;
        }
    }
}
