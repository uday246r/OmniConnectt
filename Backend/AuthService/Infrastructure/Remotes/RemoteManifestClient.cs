using System.Text.Json;
using AuthService.Domain.Enums;

namespace AuthService.Infrastructure.Remotes;

/// <summary>Outcome of one probe. <paramref name="ContainerName"/> is only populated on success.</summary>
public record ManifestProbeResult(RemoteAppHealth Health, string? ContainerName, string? Error);

/// <summary>
/// Fetches and minimally validates a remote app's <c>mf-manifest.json</c>.
/// <para>
/// This exists because registering a remote app previously validated only that ManifestUrl parsed as
/// a URI — never that anything was actually served there. A typo'd or dead URL was accepted happily
/// and only surfaced as a Module Federation runtime error when a user clicked the sidebar link.
/// </para>
/// <para>
/// Every failure is returned, never thrown: a remote being down must never take down the registry,
/// and the reported error text is the real transport/HTTP failure so operators can act on it.
/// </para>
/// </summary>
public class RemoteManifestClient(HttpClient httpClient, ILogger<RemoteManifestClient> logger)
{
    public async Task<ManifestProbeResult> ProbeAsync(string manifestUrl, CancellationToken ct = default)
    {
        try
        {
            using var response = await httpClient.GetAsync(manifestUrl, ct);
            if (!response.IsSuccessStatusCode)
            {
                return new ManifestProbeResult(
                    RemoteAppHealth.Unreachable,
                    null,
                    $"Manifest returned HTTP {(int)response.StatusCode} {response.ReasonPhrase}.");
            }

            var body = await response.Content.ReadAsStringAsync(ct);
            using var document = JsonDocument.Parse(body);

            // A Module Federation manifest always carries a container name. Requiring it means a
            // server that returns 200 with an unrelated body (a SPA index.html fallback, a proxy
            // error page) is correctly reported unreachable rather than falsely healthy.
            if (!document.RootElement.TryGetProperty("name", out var nameElement) || nameElement.ValueKind != JsonValueKind.String)
            {
                return new ManifestProbeResult(
                    RemoteAppHealth.Unreachable,
                    null,
                    "The URL responded, but the body is not a Module Federation manifest (no 'name' field).");
            }

            return new ManifestProbeResult(RemoteAppHealth.Healthy, nameElement.GetString(), null);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (TaskCanceledException)
        {
            // Distinct from caller-cancellation above: this is the HttpClient timeout elapsing.
            return new ManifestProbeResult(RemoteAppHealth.Unreachable, null, "Timed out fetching the manifest.");
        }
        catch (HttpRequestException ex)
        {
            return new ManifestProbeResult(RemoteAppHealth.Unreachable, null, ex.Message);
        }
        catch (JsonException ex)
        {
            return new ManifestProbeResult(RemoteAppHealth.Unreachable, null, $"Manifest is not valid JSON: {ex.Message}");
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Unexpected error probing manifest at {ManifestUrl}.", manifestUrl);
            return new ManifestProbeResult(RemoteAppHealth.Unreachable, null, ex.Message);
        }
    }
}
