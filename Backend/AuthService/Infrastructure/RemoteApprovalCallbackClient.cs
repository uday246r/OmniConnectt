using System.Net.Http.Json;
using AuthService.Application.DTOs;
using AuthService.Options;
using Microsoft.Extensions.Options;

namespace AuthService.Infrastructure;

/// <summary>
/// The other half of InternalApprovalsController: where a remote-owned ApprovalRequest gets replayed.
/// ApprovalAppService.ReplayAsync's default case (every module AuthService doesn't own in-process) POSTs
/// here — to the ORIGIN service's own CallbackUrl, not a fixed address, since each remote exposes its own
/// internal/approvals/apply endpoint.
///
/// Deliberately NOT best-effort like AuthServiceClient.PushAuditLogAsync elsewhere in this codebase — a
/// failed audit-log push only loses a log line, but a failed replay must leave the ApprovalRequest Pending
/// rather than silently mark it Approved with nothing actually applied. Callers must let exceptions
/// propagate.
/// </summary>
/// <remarks>
/// The key sent is the ORIGIN service's own key, so each remote only ever needs to recognise one secret —
/// its own — and a remote never learns another service's key. The legacy shared key is used only while
/// per-service keys are not configured.
/// </remarks>
public class RemoteApprovalCallbackClient(HttpClient httpClient, IOptions<InternalApiOptions> options)
{
    public async Task ApplyAsync(string callbackUrl, ApplyApprovedMutationRequest payload, CancellationToken ct, string? sourceService = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, callbackUrl)
        {
            Content = JsonContent.Create(payload),
        };
        request.Headers.Add("X-Internal-Api-Key", ResolveKey(options.Value, sourceService));
        if (!string.IsNullOrWhiteSpace(payload.CorrelationId))
        {
            request.Headers.Add("X-Correlation-Id", payload.CorrelationId);
        }

        var response = await httpClient.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"Replaying the approved mutation against '{callbackUrl}' failed with {(int)response.StatusCode}: {body}");
        }
    }

    internal static string ResolveKey(InternalApiOptions options, string? sourceService)
    {
        if (options.UsesPerServiceKeys)
        {
            if (sourceService is not null
                && options.Services.TryGetValue(sourceService, out var credential)
                && !string.IsNullOrWhiteSpace(credential.ApiKey))
            {
                return credential.ApiKey.Trim();
            }

            throw new InvalidOperationException(
                $"No internal API key is configured for '{sourceService ?? "(unknown service)"}', so its approved change cannot be sent back to it. " +
                $"Set Internal__Services__{sourceService}__ApiKey.");
        }

        return options.ApiKey?.Trim() ?? string.Empty;
    }
}
