using System.Net.Http.Json;
using backend.Models;
using backend.Options;
using Microsoft.Extensions.Options;

namespace backend.Infrastructure;

/// <summary>
/// This service's first-ever connection to AuthService's internal surface — previously Customer360Service
/// kept its own local audit trail entirely (see AuditRepository.cs) and had no cross-service plumbing at
/// all. Mirrors LeadService's/ModuleRegistry's own AuthServiceClient shape exactly: pushes central
/// platform audit-log entries (best-effort, failures logged not thrown) and — Phase 2 — checks/submits
/// Maker-Checker gating for Field Settings mutations (hard-fail; see IsGatedAsync's own doc comment).
/// </summary>
public class AuthServiceClient(HttpClient httpClient, IOptions<AuthIntegrationOptions> options, ILogger<AuthServiceClient> logger, IHttpContextAccessor httpContextAccessor)
{
    private readonly AuthIntegrationOptions _options = options.Value;

    private record RecordAuditLogRequest(
        string ServiceName, Guid? ActorUserId, string? ActorName, string Action, string? EntityType, string? EntityId, string? Details,
        string? EntityLabel, string? SourceIp, string? UserAgent, string? CorrelationId = null);

    private record SubmitInternalApprovalRequest(
        string Module, string Action, string? EntityType, string? EntityId, string? EntityLabel,
        string? OldDataJson, string NewDataJson, Guid MakerId, string SourceService, string CallbackUrl, string? CorrelationId);

    private record GatedResponse(bool Gated);

    public Task<bool> PushAuditLogAsync(string action, string? entityType, string? entityId, string? details, Guid? actorUserId, string? actorName, string? entityLabel = null, CancellationToken ct = default)
    {
        var httpContext = httpContextAccessor.HttpContext;
        var sourceIp = httpContext?.Connection.RemoteIpAddress?.ToString();
        var userAgent = httpContext?.Request.Headers.UserAgent.ToString();
        // This service's own request id, so two audit writes fired within the same inbound request
        // (e.g. a mutation plus a related side-effect) land in AuthService sharing one correlation id
        // instead of each minting its own from AuthService's perspective of a fresh internal POST.
        var correlationId = httpContext?.TraceIdentifier;
        return PostAsync(
            "internal/audit-logs",
            new RecordAuditLogRequest("Customer360Service", actorUserId, actorName, action, entityType, entityId, details, entityLabel, sourceIp, userAgent, correlationId),
            ct);
    }

    /// <summary>
    /// Maker-Checker gating check. UNLIKE PushAuditLogAsync above, this deliberately does NOT swallow
    /// failures — a gating check AuthService couldn't answer must block the mutation, not let it
    /// through unchecked. Any network failure or non-2xx throws ApprovalServiceUnavailableException.
    /// </summary>
    public async Task<bool> IsGatedAsync(string module, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_options.BaseUrl))
        {
            throw new ApprovalServiceUnavailableException(
                "AuthService__BaseUrl is not configured — cannot verify whether this action requires approval.");
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, $"{_options.BaseUrl.TrimEnd('/')}/internal/approvals/gated/{Uri.EscapeDataString(module)}");
            request.Headers.Add("X-Internal-Api-Key", _options.InternalApiKey);
            using var response = await httpClient.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                throw new ApprovalServiceUnavailableException($"AuthService rejected the approval-gating check for '{module}': {response.StatusCode}.");
            }

            var body = await response.Content.ReadFromJsonAsync<GatedResponse>(cancellationToken: ct);
            return body?.Gated ?? throw new ApprovalServiceUnavailableException(
                $"AuthService returned an unexpected response for the approval-gating check on '{module}'.");
        }
        catch (Exception ex) when (ex is not ApprovalServiceUnavailableException)
        {
            throw new ApprovalServiceUnavailableException($"Could not reach AuthService to verify whether '{module}' requires approval: {ex.Message}");
        }
    }

    /// <summary>Submits a gated mutation for approval. Same hard-fail contract as <see cref="IsGatedAsync"/>.</summary>
    public async Task<ApprovalPendingDto> SubmitApprovalAsync(
        string module, string action, string? entityType, string? entityId, string? entityLabel,
        string? oldDataJson, string newDataJson, Guid makerId, string callbackUrl, string correlationId,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_options.BaseUrl))
        {
            throw new ApprovalServiceUnavailableException("AuthService__BaseUrl is not configured — cannot submit this action for approval.");
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, $"{_options.BaseUrl.TrimEnd('/')}/internal/approvals/submit")
            {
                Content = JsonContent.Create(new SubmitInternalApprovalRequest(
                    module, action, entityType, entityId, entityLabel, oldDataJson, newDataJson, makerId,
                    "Customer360Service", callbackUrl, correlationId)),
            };
            request.Headers.Add("X-Internal-Api-Key", _options.InternalApiKey);

            var response = await httpClient.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync(ct);
                throw new ApprovalServiceUnavailableException($"AuthService rejected the approval submission: {response.StatusCode} {body}");
            }

            return await response.Content.ReadFromJsonAsync<ApprovalPendingDto>(cancellationToken: ct)
                ?? throw new ApprovalServiceUnavailableException("AuthService returned an empty response for the approval submission.");
        }
        catch (Exception ex) when (ex is not ApprovalServiceUnavailableException)
        {
            throw new ApprovalServiceUnavailableException($"Could not reach AuthService to submit this action for approval: {ex.Message}");
        }
    }

    private async Task<bool> PostAsync<TBody>(string path, TBody body, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(_options.BaseUrl))
        {
            logger.LogDebug("AuthService__BaseUrl is not configured — skipping call to {Path}.", path);
            return false;
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, $"{_options.BaseUrl.TrimEnd('/')}/{path}")
            {
                Content = JsonContent.Create(body),
            };
            if (!string.IsNullOrWhiteSpace(_options.InternalApiKey))
            {
                request.Headers.Add("X-Internal-Api-Key", _options.InternalApiKey);
            }

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
