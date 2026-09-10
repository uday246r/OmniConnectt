using System.Text.Json.Serialization;
using System.Net.Http.Json;
using Microsoft.Extensions.Options;
using ModuleRegistry.Application.DTOs;
using ModuleRegistry.Application.Exceptions;
using ModuleRegistry.Domain;
using ModuleRegistry.Options;

namespace ModuleRegistry.Infrastructure;

/// <summary>
/// Pushes RemoteApp-sourced permission-feature changes into AuthService's catalog whenever an
/// admin creates, edits, removes, or bulk-resyncs remote apps here. AuthService's Role editor reads
/// its own PermissionFeatures table on every open — this push is what keeps that table caught up,
/// so the Role editor never has to call ModuleRegistry live on that hot path. See the plan's
/// "Permission-catalog sync mechanism" section for the full rationale.
///
/// Also doubles as the client for two unrelated-but-adjacent concerns that share the same
/// internal-API-key trust boundary: fetching a remote app's self-declared capabilities from its own
/// PermissionsSourceUrl, and pushing this service's own audit-log entries to AuthService's central
/// log.
///
/// Failures are logged, not thrown — a transient AuthService (or remote-app) outage during a
/// registry edit shouldn't block the admin's edit here; POST /api/remote-apps/resync-permissions
/// exists as the manual recovery path once everything is back.
/// </summary>
public class AuthServiceClient(HttpClient httpClient, IOptions<AuthIntegrationOptions> options, ILogger<AuthServiceClient> logger, IHttpContextAccessor httpContextAccessor)
{
    private readonly AuthIntegrationOptions _options = options.Value;

    private record UpsertCapabilityRequest(
        string Key,
        string DisplayName,
        int SortOrder = 100,
        string? Description = null,
        string Type = "Api");

    /// <summary>One sidebar row. Nullable everywhere so an older AuthService simply ignores it.</summary>
    private record UpsertNavItemRequest(
        string Key, string Label, string? IconKey, string RouteSegment, int SortOrder, string? RequiredCapability);

    /// <summary>One sub-module of a feature, with its own capabilities. AuthService turns each into a child PermissionFeature.</summary>
    private record UpsertModuleRequest(
        string Key,
        string DisplayName,
        int SortOrder,
        IReadOnlyList<UpsertCapabilityRequest> Capabilities,
        /// <summary>Null means "leave whatever nav AuthService already has"; empty means "this module has no rows".</summary>
        IReadOnlyList<UpsertNavItemRequest>? Nav);

    private record UpsertFeatureRequest(
        string Key,
        string DisplayName,
        int SortOrder,
        IReadOnlyList<UpsertCapabilityRequest> Capabilities,
        IReadOnlyList<UpsertModuleRequest> Modules,
        // Render metadata replicated into AuthDb so the navigation tree can be served from one
        // database. ModuleRegistry stays the system of record; this is a copy, refreshed on the same
        // events that already push capabilities. Health is deliberately NOT here — it is rewritten on
        // an interval by the health probe, so a replicated copy would always be stale.
        string? IconKey = null,
        string? ManifestUrl = null,
        string? ContainerName = null,
        string? Status = null,
        string? MaintenanceMessage = null);
    private record DeactivateFeatureRequest(string Key);
    private record ResyncFeaturesRequest(IReadOnlyList<UpsertFeatureRequest> Features);
    private record RecordAuditLogRequest(
        string ServiceName, Guid? ActorUserId, string? ActorName, string Action, string? EntityType, string? EntityId, string? Details,
        string? EntityLabel, string? SourceIp, string? UserAgent);

    private record SubmitInternalApprovalRequest(
        string Module, string Action, string? EntityType, string? EntityId, string? EntityLabel,
        string? OldDataJson, string NewDataJson, Guid MakerId, string SourceService, string CallbackUrl, string? CorrelationId,
        string? EntityKey = null);

    public Task<bool> UpsertAsync(
        string featureKey, string displayName, int sortOrder,
        IReadOnlyList<RemoteCapability> capabilities, CancellationToken ct = default,
        IReadOnlyList<RemoteNavItem>? nav = null, RemoteAppRenderMetadata? render = null) =>
        PostAsync(
            "internal/permission-features/upsert",
            BuildFeatureRequest(featureKey, displayName, sortOrder, capabilities, nav, render),
            ct);

    public Task<bool> DeactivateAsync(string featureKey, CancellationToken ct = default) =>
        PostAsync("internal/permission-features/deactivate", new DeactivateFeatureRequest(featureKey), ct);

    public Task<bool> ResyncAsync(
        IReadOnlyList<(string Key, string DisplayName, int SortOrder, IReadOnlyList<RemoteCapability> Capabilities,
                       IReadOnlyList<RemoteNavItem>? Nav, RemoteAppRenderMetadata? Render)> features,
        CancellationToken ct = default) =>
        PostAsync(
            "internal/permission-features/resync",
            new ResyncFeaturesRequest(features
                .Select(f => BuildFeatureRequest(f.Key, f.DisplayName, f.SortOrder, f.Capabilities, f.Nav, f.Render))
                .ToList()),
            ct);

    // sourceIp/userAgent are pulled off THIS service's own current HttpContext, not AuthService's —
    // by the time a request reaches AuthService's internal endpoint it's this service calling that
    // one, so AuthService's own connection info would just be this server's address, not the real
    // end user's. entityLabel is the one thing that can't be derived from ambient state — the
    // caller passes the specific record's human-readable name (e.g. a remote app's display name).
    public Task<bool> PushAuditLogAsync(string action, string? entityType, string? entityId, string? details, Guid? actorUserId, string? actorName, string? entityLabel = null, CancellationToken ct = default)
    {
        var httpContext = httpContextAccessor.HttpContext;
        var sourceIp = httpContext?.Connection.RemoteIpAddress?.ToString();
        var userAgent = httpContext?.Request.Headers.UserAgent.ToString();
        return PostAsync(
            "internal/audit-logs",
            new RecordAuditLogRequest("ModuleRegistry", actorUserId, actorName, action, entityType, entityId, details, entityLabel, sourceIp, userAgent),
            ct);
    }

    /// <summary>
    /// Pushes a system-level log (error, warning, health event) to AuthService's centralized system
    /// log table, matching PushAuditLogAsync's best-effort semantics — a transient failure logs a
    /// warning locally rather than blocking the caller.
    /// </summary>
    public Task<bool> PushSystemLogAsync(string severity, string eventCode, string message, string? module = null,
        int? statusCode = null, string? stackTrace = null, string? metadata = null, CancellationToken ct = default)
    {
        var httpContext = httpContextAccessor.HttpContext;
        return PostAsync(
            "internal/system-logs",
            new RecordSystemLogRequest(severity, "ModuleRegistry", eventCode, message, module,
                CorrelationId: httpContext?.TraceIdentifier, RequestId: httpContext?.TraceIdentifier,
                StatusCode: statusCode, StackTrace: stackTrace, Metadata: metadata),
            ct);
    }

    private record RecordSystemLogRequest(
        string Severity, string ServiceName, string EventCode, string Message,
        string? Module = null, string? Environment = null, string? TenantId = null, Guid? UserId = null,
        string? CorrelationId = null, string? RequestId = null, int? StatusCode = null,
        string? StackTrace = null, string? Metadata = null);

    /// <summary>
    /// Maker-Checker gating check. UNLIKE every other method on this class, this deliberately does NOT
    /// swallow failures — a gating check AuthService couldn't answer must block the mutation, not let
    /// it through unchecked. Any network failure or non-2xx throws ApprovalServiceUnavailableAppException.
    /// </summary>
    public async Task<bool> IsGatedAsync(string module, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_options.BaseUrl))
        {
            throw new ApprovalServiceUnavailableAppException(
                "AuthService__BaseUrl is not configured — cannot verify whether this action requires approval.");
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, $"{_options.BaseUrl.TrimEnd('/')}/internal/approvals/gated/{Uri.EscapeDataString(module)}");
            request.Headers.Add("X-Internal-Api-Key", _options.InternalApiKey);
            using var response = await httpClient.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                throw new ApprovalServiceUnavailableAppException(
                    $"AuthService rejected the approval-gating check for '{module}': {response.StatusCode}.");
            }

            var body = await response.Content.ReadFromJsonAsync<GatedResponse>(cancellationToken: ct);
            return body?.Gated ?? throw new ApprovalServiceUnavailableAppException(
                $"AuthService returned an unexpected response for the approval-gating check on '{module}'.");
        }
        catch (Exception ex) when (ex is not ApprovalServiceUnavailableAppException)
        {
            throw new ApprovalServiceUnavailableAppException(
                $"Could not reach AuthService to verify whether '{module}' requires approval: {ex.Message}");
        }
    }

    /// <summary>Submits a gated mutation for approval. Same hard-fail contract as <see cref="IsGatedAsync"/> — a
    /// submission failure must surface as an error, never silently apply the mutation instead.</summary>
    public async Task<ApprovalPendingDto> SubmitApprovalAsync(
        string module, string action, string? entityType, string? entityId, string? entityLabel,
        string? oldDataJson, string newDataJson, Guid makerId, string callbackUrl, string correlationId,
        // Required for Create, which has no entity id yet — see SubmitInternalApprovalRequest.EntityKey.
        CancellationToken ct = default, string? entityKey = null)
    {
        if (string.IsNullOrWhiteSpace(_options.BaseUrl))
        {
            throw new ApprovalServiceUnavailableAppException(
                "AuthService__BaseUrl is not configured — cannot submit this action for approval.");
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, $"{_options.BaseUrl.TrimEnd('/')}/internal/approvals/submit")
            {
                Content = JsonContent.Create(new SubmitInternalApprovalRequest(
                    module, action, entityType, entityId, entityLabel, oldDataJson, newDataJson, makerId,
                    "ModuleRegistry", callbackUrl, correlationId, entityKey)),
            };
            request.Headers.Add("X-Internal-Api-Key", _options.InternalApiKey);

            var response = await httpClient.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync(ct);
                throw new ApprovalServiceUnavailableAppException($"AuthService rejected the approval submission: {response.StatusCode} {body}");
            }

            return await response.Content.ReadFromJsonAsync<ApprovalPendingDto>(cancellationToken: ct)
                ?? throw new ApprovalServiceUnavailableAppException("AuthService returned an empty response for the approval submission.");
        }
        catch (Exception ex) when (ex is not ApprovalServiceUnavailableAppException)
        {
            throw new ApprovalServiceUnavailableAppException($"Could not reach AuthService to submit this action for approval: {ex.Message}");
        }
    }

    private record GatedResponse(bool Gated);

    private record RemoteCapabilitiesResponse(
        [property: JsonPropertyName("modules")] List<RemoteModuleEntry>? Modules,
        [property: JsonPropertyName("capabilities")] List<RemoteCapabilityEntry>? Capabilities);

    private record RemoteModuleEntry(
        [property: JsonPropertyName("key")] string Key,
        [property: JsonPropertyName("displayName")] string DisplayName,
        [property: JsonPropertyName("capabilities")] List<RemoteCapabilityEntry>? Capabilities,
        [property: JsonPropertyName("sortOrder")] int SortOrder = 0,
        [property: JsonPropertyName("nav")] List<RemoteNavEntry>? Nav = null);

    private record RemoteNavEntry(
        [property: JsonPropertyName("key")] string Key,
        [property: JsonPropertyName("label")] string Label,
        [property: JsonPropertyName("iconKey")] string? IconKey,
        [property: JsonPropertyName("routeSegment")] string RouteSegment,
        [property: JsonPropertyName("sortOrder")] int SortOrder,
        [property: JsonPropertyName("requiredCapability")] string? RequiredCapability);

    /// <param name="Type">
    /// Absent from every remote that predates the capability manifest, and absent means "Api" — an
    /// endpoint guard, which is all those remotes ever declared. Relayed verbatim rather than parsed:
    /// a value this service does not recognise is AuthService's to interpret, and dropping it here
    /// would turn a forward-compatible payload into a lossy one.
    /// </param>
    private record RemoteCapabilityEntry(
        [property: JsonPropertyName("key")] string Key,
        [property: JsonPropertyName("displayName")] string DisplayName,
        [property: JsonPropertyName("description")] string? Description = null,
        [property: JsonPropertyName("type")] string? Type = null);

    /// <summary>
    /// GETs a remote app's own PermissionsSourceUrl.
    /// <para>
    /// Prefers the v2 shape — <c>{ "modules": [{ "key", "displayName", "capabilities": [...] }] }</c> —
    /// and falls back to the original flat <c>{ "capabilities": [...] }</c>, which is treated as one
    /// unnamed module. That fallback is what lets a remote app built against the older contract keep
    /// working untouched instead of suddenly reporting zero permissions and revoking everyone's
    /// access to it.
    /// </para>
    /// <para>
    /// Returns null (never an empty list) on any failure so callers can tell "unreachable, keep the
    /// last-known set" apart from "reachable and genuinely declares zero capabilities".
    /// </para>
    /// </summary>
    public async Task<RemoteDiscovery?> FetchRemoteCapabilitiesAsync(string sourceUrl, CancellationToken ct = default)
    {
        try
        {
            using var response = await httpClient.GetAsync(sourceUrl, ct);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Remote app permissions source {Url} returned {StatusCode}. Keeping last-known capability set.", sourceUrl, response.StatusCode);
                return null;
            }

            var body = await response.Content.ReadFromJsonAsync<RemoteCapabilitiesResponse>(cancellationToken: ct);

            if (body?.Modules is { Count: > 0 })
            {
                var capabilities = body.Modules
                    .SelectMany(m => (m.Capabilities ?? [])
                        .Select(c => new RemoteCapability(m.Key, m.DisplayName, c.Key, c.DisplayName, c.Description, c.Type ?? "Api")))
                    .ToList();

                // v3 — the remote declares its own sidebar rows.
                if (body.Modules.Any(m => m.Nav is not null))
                {
                    var nav = body.Modules
                        .SelectMany(m => (m.Nav ?? [])
                            .Select(n => new RemoteNavItem(
                                m.Key, n.Key, n.Label, n.IconKey, n.RouteSegment, n.SortOrder, n.RequiredCapability)))
                        .ToList();

                    return new RemoteDiscovery(capabilities, nav);
                }

                // v2 — modules but no nav. Synthesise one row per module so the sidebar is still
                // complete and correctly permissioned; it just falls back to the host's default icon
                // and uses the module key as both label and route. An un-upgraded remote must not
                // lose its navigation entirely.
                logger.LogInformation(
                    "Remote app permissions source {Url} reports modules without navigation (v2). Synthesising one sidebar row per module.",
                    sourceUrl);

                var synthesised = body.Modules
                    .Select((m, i) => new RemoteNavItem(
                        m.Key,
                        m.Key.ToLowerInvariant(),
                        string.IsNullOrWhiteSpace(m.DisplayName) ? m.Key : m.DisplayName,
                        IconKey: null,
                        RouteSegment: m.Key.ToLowerInvariant(),
                        SortOrder: i * 10,
                        RequiredCapability: null))
                    .ToList();

                return new RemoteDiscovery(capabilities, synthesised);
            }

            if (body?.Capabilities is not null)
            {
                logger.LogInformation(
                    "Remote app permissions source {Url} uses the flat (v1) contract. Treating its capabilities as one implicit module.",
                    sourceUrl);

                // Empty ModuleKey means "no sub-module" — AuthService hangs these capabilities
                // directly off the app's own feature, exactly as before.
                //
                // Nav is null, not empty: a v1 remote has no opinion about navigation, so AuthService
                // must keep whatever it already holds rather than clearing the app's sidebar.
                return new RemoteDiscovery(
                    body.Capabilities
                        .Select(c => new RemoteCapability(string.Empty, string.Empty, c.Key, c.DisplayName))
                        .ToList(),
                    Nav: null);
            }

            logger.LogWarning("Remote app permissions source {Url} returned an unexpected shape. Keeping last-known capability set.", sourceUrl);
            return null;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to fetch remote app permissions from {Url}. Keeping last-known capability set.", sourceUrl);
            return null;
        }
    }

    /// <summary>Groups the flat capability rows back into the nested module shape AuthService expects.</summary>
    private static UpsertFeatureRequest BuildFeatureRequest(
        string featureKey,
        string displayName,
        int sortOrder,
        IReadOnlyList<RemoteCapability> capabilities,
        IReadOnlyList<RemoteNavItem>? nav = null,
        RemoteAppRenderMetadata? render = null)
    {
        // Capabilities with no module hang directly off the feature; the rest become child features.
        var rootCapabilities = capabilities
            .Where(c => string.IsNullOrEmpty(c.ModuleKey))
            .Select((c, i) => new UpsertCapabilityRequest(c.Key, c.DisplayName, i * 10, c.Description, c.Type))
            .ToList();

        // Grouped once rather than per module, so the whole projection stays O(n).
        var navByModule = nav?
            .GroupBy(n => n.ModuleKey, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);

        var modules = capabilities
            .Where(c => !string.IsNullOrEmpty(c.ModuleKey))
            .GroupBy(c => (c.ModuleKey, c.ModuleDisplayName))
            .Select((g, moduleIndex) => new UpsertModuleRequest(
                g.Key.ModuleKey,
                g.Key.ModuleDisplayName,
                moduleIndex * 10,
                g.Select((c, i) => new UpsertCapabilityRequest(c.Key, c.DisplayName, i * 10, c.Description, c.Type)).ToList(),
                // Null when the remote reported no navigation at all, so AuthService keeps what it
                // has. An empty list for a module the remote DID describe is a real answer: that
                // module is grantable but has no sidebar row.
                navByModule is null
                    ? null
                    : (navByModule.TryGetValue(g.Key.ModuleKey, out var rows) ? rows : [])
                        .OrderBy(n => n.SortOrder)
                        .Select(n => new UpsertNavItemRequest(
                            n.Key, n.Label, n.IconKey, n.RouteSegment, n.SortOrder, n.RequiredCapability))
                        .ToList()))
            .ToList();

        return new UpsertFeatureRequest(
            featureKey, displayName, sortOrder, rootCapabilities, modules,
            render?.IconKey, render?.ManifestUrl, render?.ContainerName, render?.Status, render?.MaintenanceMessage);
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
                logger.LogWarning(
                    "AuthService rejected call to {Path}: {StatusCode}. Run resync-permissions once it's fixed.",
                    path, response.StatusCode);
                return false;
            }

            return true;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to reach AuthService for call to {Path}. Run resync-permissions once it's reachable.", path);
            return false;
        }
    }
}
