using System.Text.Json;
using AuthService.Domain.Enums;
using AuthService.Options;
using Microsoft.Extensions.Options;

namespace AuthService.Infrastructure.Remotes;

/// <summary>
/// What a built remote says about itself in its manifest. <paramref name="BuildVersion"/> is
/// <c>metaData.buildInfo.buildVersion</c>; <paramref name="RequiredHostBridge"/> is the SemVer range of
/// host bridges it works with (<c>metaData.omniconnect.requiredHostBridge</c>), null when it declares none.
/// </summary>
public record ManifestMetadata(string? BuildVersion, string? RequiredHostBridge);

/// <summary>Outcome of one probe. <paramref name="ContainerName"/> and <paramref name="Metadata"/> are only populated on success.</summary>
public record ManifestProbeResult(RemoteAppHealth Health, string? ContainerName, string? Error, ManifestMetadata? Metadata = null);

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
public class RemoteManifestClient(
    HttpClient httpClient,
    ILogger<RemoteManifestClient> logger,
    IOptions<RemoteAppsOptions>? options = null)
{
    public async Task<ManifestProbeResult> ProbeAsync(string manifestUrl, CancellationToken ct = default)
    {
        var target = Resolve(manifestUrl);
        if (target is null)
        {
            return new ManifestProbeResult(
                RemoteAppHealth.Unreachable,
                null,
                "This manifest URL is a path on the platform's own web server, but RemoteApps:InternalBaseUrl "
                + "is not configured, so AuthService cannot reach it.");
        }

        try
        {
            using var response = await httpClient.GetAsync(target, ct);
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

            return new ManifestProbeResult(RemoteAppHealth.Healthy, nameElement.GetString(), null, ReadMetadata(document.RootElement));
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

    /// <summary>
    /// The URL to fetch. A root-relative manifest URL — the normal production shape — is resolved
    /// against the web server's internal address; null when that address is not configured.
    /// </summary>
    internal Uri? Resolve(string manifestUrl)
    {
        if (!manifestUrl.StartsWith('/'))
        {
            return Uri.TryCreate(manifestUrl, UriKind.Absolute, out var absolute) ? absolute : null;
        }

        var baseUrl = options?.Value.InternalBaseUrl?.Trim();
        if (string.IsNullOrEmpty(baseUrl) || !Uri.TryCreate(baseUrl.TrimEnd('/') + "/", UriKind.Absolute, out var root))
        {
            return null;
        }

        return new Uri(root, manifestUrl.TrimStart('/'));
    }

    private static ManifestMetadata ReadMetadata(JsonElement root)
    {
        static string? Text(JsonElement parent, params string[] path)
        {
            var current = parent;
            foreach (var segment in path)
            {
                if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current))
                {
                    return null;
                }
            }
            return current.ValueKind == JsonValueKind.String ? current.GetString() : null;
        }

        return new ManifestMetadata(
            Text(root, "metaData", "buildInfo", "buildVersion"),
            Text(root, "metaData", "omniconnect", "requiredHostBridge"));
    }
}
