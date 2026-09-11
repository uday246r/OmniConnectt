using System.Net.Http.Json;
using System.Text.Json.Serialization;
using AuthService.Application.Remotes;

namespace AuthService.Infrastructure.Remotes;

/// <summary>
/// Reads a remote app's own <c>GET /permissions</c> and turns whatever it finds there into a
/// <see cref="RemoteDiscovery"/>.
/// </summary>
/// <remarks>
/// <para>
/// Four contract versions are accepted, oldest still working: <b>v1</b> a flat
/// <c>{ "capabilities": [...] }</c>, treated as one implicit module; <b>v2</b>
/// <c>{ "modules": [{ key, displayName, capabilities }] }</c>; <b>v3</b> adds <c>modules[].nav</c>,
/// letting a remote declare its own sidebar rows; <b>v4</b> adds <c>description</c> and <c>type</c>
/// per capability, which decide whether AuthService delivers it in the JWT or separately.
/// </para>
/// <para>
/// The ladder is not politeness — it is what stops an upgrade of this service from silently revoking
/// access. A remote built against an older contract that suddenly reported zero capabilities would
/// have every grant on it deactivated, and nobody would notice until a user could not open the app.
/// </para>
/// <para>
/// <b>Null is the load-bearing return value.</b> Every failure path — unreachable, non-2xx, malformed,
/// a shape this ladder does not recognise — answers null, meaning "the remote said nothing". The
/// caller passes that straight through to the permission catalog, which then leaves the stored
/// capability set exactly as it is. An empty list would mean something entirely different: that the
/// remote positively declared it has no capabilities, which deactivates them. A remote restarting
/// mid-deploy must never look like a remote withdrawing every permission it grants.
/// </para>
/// </remarks>
public class RemoteCapabilityDiscoveryClient(
    HttpClient httpClient,
    ILogger<RemoteCapabilityDiscoveryClient> logger)
{
    /// <summary>Null when the remote could not be read or understood — see the class remarks.</summary>
    public async Task<RemoteDiscovery?> FetchAsync(string sourceUrl, CancellationToken ct = default)
    {
        try
        {
            using var response = await httpClient.GetAsync(sourceUrl, ct);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning(
                    "Remote app permissions source {Url} returned {StatusCode}. Keeping last-known capability set.",
                    sourceUrl, response.StatusCode);
                return null;
            }

            var body = await response.Content.ReadFromJsonAsync<RemoteCapabilitiesResponse>(cancellationToken: ct);

            if (body?.Modules is { Count: > 0 })
            {
                var capabilities = body.Modules
                    .SelectMany(m => (m.Capabilities ?? [])
                        .Select(c => new RemoteCapability(m.Key, m.DisplayName, c.Key, c.DisplayName, c.Description, c.Type ?? "Api")))
                    .ToList();

                // v3/v4 — the remote declares its own sidebar rows.
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

                // Empty ModuleKey means "no sub-module" — the capabilities hang directly off the
                // app's own feature.
                //
                // Nav is null, not empty: a v1 remote has no opinion about navigation, so the stored
                // sidebar rows must be kept rather than cleared.
                return new RemoteDiscovery(
                    body.Capabilities
                        .Select(c => new RemoteCapability(string.Empty, string.Empty, c.Key, c.DisplayName, c.Description, c.Type ?? "Api"))
                        .ToList(),
                    Nav: null);
            }

            logger.LogWarning(
                "Remote app permissions source {Url} returned an unexpected shape. Keeping last-known capability set.",
                sourceUrl);
            return null;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogWarning(
                ex, "Failed to fetch remote app permissions from {Url}. Keeping last-known capability set.", sourceUrl);
            return null;
        }
    }

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
    /// a value this client does not recognise is the permission catalog's to interpret, and dropping
    /// it here would turn a forward-compatible payload into a lossy one.
    /// </param>
    private record RemoteCapabilityEntry(
        [property: JsonPropertyName("key")] string Key,
        [property: JsonPropertyName("displayName")] string DisplayName,
        [property: JsonPropertyName("description")] string? Description = null,
        [property: JsonPropertyName("type")] string? Type = null);
}
