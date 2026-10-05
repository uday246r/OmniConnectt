namespace OmniConnect.Hosting;

/// <summary>
/// Lets a service's own binary act as its container healthcheck:
/// <c>dotnet LeadManagement.Api.dll --healthcheck http://127.0.0.1:8080/health/live</c>.
/// </summary>
/// <remarks>
/// The <c>aspnet</c> runtime image ships neither curl nor wget, and adding one to every image only to
/// probe localhost widens the attack surface of a production container. Reusing the runtime that is
/// already there costs nothing. It must be the first statement in Program.cs — before .env loading,
/// configuration or the host — so a probe never boots a second copy of the service.
/// </remarks>
public static class ContainerHealthProbe
{
    public const string Flag = "--healthcheck";

    /// <summary>Runs the probe and exits the process if <c>--healthcheck</c> was passed; otherwise returns.</summary>
    public static void RunIfRequested(string[] args)
    {
        var index = Array.IndexOf(args, Flag);
        if (index < 0) return;

        var url = index + 1 < args.Length ? args[index + 1] : "http://127.0.0.1:8080/health/live";
        Environment.Exit(ProbeAsync(url).GetAwaiter().GetResult());
    }

    /// <summary>0 when the URL answers 2xx within five seconds, 1 otherwise — the docker HEALTHCHECK contract.</summary>
    public static async Task<int> ProbeAsync(string url, HttpMessageHandler? handler = null)
    {
        try
        {
            using var client = handler is null ? new HttpClient() : new HttpClient(handler);
            client.Timeout = TimeSpan.FromSeconds(5);
            using var response = await client.GetAsync(url);
            return response.IsSuccessStatusCode ? 0 : 1;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or UriFormatException or InvalidOperationException)
        {
            return 1;
        }
    }
}
