using System.Net.Http.Json;
using Microsoft.Extensions.Options;
using ProductMarketplace.Api.Options;

namespace ProductMarketplace.Api.Infrastructure;

/// <summary>
/// Everything this service asks of AuthService: whether a module needs approval, filing a change for
/// approval, and copying audit entries and errors into the platform's central logs.
/// </summary>
/// <remarks>
/// Two different failure contracts, on purpose. Approval calls fail hard with
/// <see cref="ApprovalServiceUnavailableException"/> (mapped to 503): applying a change whose approval
/// requirement could not be checked would be a silent maker-checker bypass. Log pushes are best effort:
/// losing a copy of a log line must never fail the action it describes.
/// </remarks>
public class AuthServiceClient(
    HttpClient httpClient,
    IOptions<AuthIntegrationOptions> options,
    IOptions<SelfOptions> self,
    IHttpContextAccessor httpContextAccessor,
    ILogger<AuthServiceClient> logger)
{
    private readonly AuthIntegrationOptions _options = options.Value;

    public sealed record ApprovalPendingDto(Guid ApprovalRequestId, string Module, string Action, string CheckerName, string Message);

    private sealed record GatedResponse(bool Gated);

    private sealed record SubmitRequest(
        string Module, string Action, string? EntityType, string? EntityId, string? EntityLabel,
        string? OldDataJson, string NewDataJson, Guid MakerId, string SourceService, string CallbackUrl,
        string? CorrelationId, string? EntityKey);

    private sealed record AuditRequest(
        string ServiceName, Guid? ActorUserId, string? ActorName, string Action, string? EntityType, string? EntityId,
        string? Details, string? EntityLabel, string? SourceIp, string? UserAgent, string? CorrelationId,
        string? SourceApplication, string? Module, string? Page, string? ActionCategory, string Result);

    private sealed record SystemLogRequest(
        string Severity, string ServiceName, string EventCode, string Message, string? Module, string? Environment,
        string? TenantId, Guid? UserId, string? CorrelationId, string? RequestId, int? StatusCode, string? StackTrace,
        string? Metadata);

    public async Task<bool> IsGatedAsync(string module, CancellationToken ct = default)
    {
        EnsureConfigured("check whether this change needs approval");

        try
        {
            using var request = Request(HttpMethod.Get, $"internal/approvals/gated/{Uri.EscapeDataString(module)}");
            using var response = await httpClient.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                throw new ApprovalServiceUnavailableException(
                    $"AuthService answered {(int)response.StatusCode} when asked whether '{module}' needs approval.");
            }

            var body = await response.Content.ReadFromJsonAsync<GatedResponse>(cancellationToken: ct);
            return body?.Gated ?? throw new ApprovalServiceUnavailableException(
                $"AuthService returned an unexpected answer when asked whether '{module}' needs approval.");
        }
        catch (Exception ex) when (ex is not ApprovalServiceUnavailableException && !ct.IsCancellationRequested)
        {
            throw new ApprovalServiceUnavailableException($"Could not reach AuthService to check whether this change needs approval: {ex.Message}");
        }
    }

    public async Task<ApprovalPendingDto> SubmitApprovalAsync(
        string module, string action, string entityType, string? entityId, string entityLabel,
        string? oldDataJson, string newDataJson, Guid makerId, string? entityKey, CancellationToken ct = default)
    {
        EnsureConfigured("submit this change for approval");
        var callbackBase = self.Value.PublicBaseUrl;
        if (string.IsNullOrWhiteSpace(callbackBase))
        {
            throw new ApprovalServiceUnavailableException("Self__PublicBaseUrl is not configured, so an approved change could not be sent back to this service.");
        }

        try
        {
            using var request = Request(HttpMethod.Post, "internal/approvals/submit");
            request.Content = JsonContent.Create(new SubmitRequest(
                module, action, entityType, entityId, entityLabel, oldDataJson, newDataJson, makerId,
                _options.ServiceName, $"{callbackBase.TrimEnd('/')}/internal/approvals/apply", CorrelationId(), entityKey));

            using var response = await httpClient.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync(ct);
                // A 409 is a real business answer — this record already has a change waiting — not an
                // outage, so it is surfaced as one.
                if ((int)response.StatusCode == StatusCodes.Status409Conflict)
                {
                    throw new ApprovalConflictException(body);
                }

                throw new ApprovalServiceUnavailableException($"AuthService refused the approval request ({(int)response.StatusCode}).");
            }

            return await response.Content.ReadFromJsonAsync<ApprovalPendingDto>(cancellationToken: ct)
                ?? throw new ApprovalServiceUnavailableException("AuthService returned an empty answer for the approval request.");
        }
        catch (Exception ex) when (ex is not ApprovalServiceUnavailableException and not ApprovalConflictException && !ct.IsCancellationRequested)
        {
            throw new ApprovalServiceUnavailableException($"Could not reach AuthService to submit this change for approval: {ex.Message}");
        }
    }

    public Task PushAuditLogAsync(
        string action, string? entityType, string? entityId, string? details, Guid? actorUserId, string? actorName,
        string? entityLabel, string? module, string? page, string? actionCategory, bool success, CancellationToken ct = default)
    {
        var http = httpContextAccessor.HttpContext;
        return PostBestEffortAsync("internal/audit-logs", new AuditRequest(
            _options.ServiceName, actorUserId, actorName, action, entityType, entityId, details, entityLabel,
            http?.Connection.RemoteIpAddress?.ToString(),
            http?.Request.Headers.UserAgent.ToString() is { Length: > 0 } ua ? ua : null,
            CorrelationId(), self.Value.DisplayName, module, page, actionCategory, success ? "Success" : "Failure"), ct);
    }

    public Task PushSystemLogAsync(
        string severity, string eventCode, string message, int? statusCode, string? stackTrace, CancellationToken ct = default)
    {
        var http = httpContextAccessor.HttpContext;
        var userId = Guid.TryParse(http?.User.FindFirst(Security.JwtClaimTypes.Subject)?.Value, out var id) ? id : (Guid?)null;
        return PostBestEffortAsync("internal/system-logs", new SystemLogRequest(
            severity, _options.ServiceName, eventCode, message, self.Value.DisplayName,
            Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT"), null, userId, CorrelationId(),
            http?.TraceIdentifier, statusCode, stackTrace, null), ct);
    }

    private async Task PostBestEffortAsync<T>(string path, T body, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(_options.BaseUrl))
        {
            return;
        }

        try
        {
            using var request = Request(HttpMethod.Post, path);
            request.Content = JsonContent.Create(body);
            using var response = await httpClient.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("AuthService answered {StatusCode} to {Path}; the entry was kept locally only.", (int)response.StatusCode, path);
            }
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning(ex, "Could not reach AuthService at {Path}; the entry was kept locally only.", path);
        }
    }

    private HttpRequestMessage Request(HttpMethod method, string path)
    {
        var request = new HttpRequestMessage(method, $"{_options.BaseUrl.TrimEnd('/')}/{path}");
        request.Headers.Add("X-Internal-Api-Key", _options.InternalApiKey.Trim());
        if (CorrelationId() is { } correlation)
        {
            request.Headers.Add("X-Correlation-Id", correlation);
        }

        return request;
    }

    /// <summary>An inbound correlation id wins, so an operation that began in the host or in an approval stays one thread.</summary>
    private string? CorrelationId()
    {
        var http = httpContextAccessor.HttpContext;
        return http?.Request.Headers["X-Correlation-Id"].ToString() is { Length: > 0 } inbound ? inbound : http?.TraceIdentifier;
    }

    private void EnsureConfigured(string what)
    {
        if (string.IsNullOrWhiteSpace(_options.BaseUrl))
        {
            throw new ApprovalServiceUnavailableException($"AuthService__BaseUrl is not configured, so this service cannot {what}.");
        }
    }
}

/// <summary>An approval requirement could not be verified; the change must not be applied (503).</summary>
public class ApprovalServiceUnavailableException(string message) : Exception(message);

/// <summary>AuthService refused a submission because the record already has a change awaiting approval (409).</summary>
public class ApprovalConflictException(string problemJson) : Exception("This record already has a change waiting for approval.")
{
    public string ProblemJson { get; } = problemJson;
}
