using AuthService.Options;

namespace AuthService.Infrastructure.Security;

/// <summary>
/// Decides whether a service may name a given URL as the place AuthService replays its approved
/// mutations to.
/// </summary>
/// <remarks>
/// AuthService POSTs the approved mutation, with that service's internal key, to whatever callback URL
/// the request carried. Left unchecked, a caller could have AuthService deliver both to an address it
/// controls. The URL must be absolute http(s), and — when the calling service has a registered
/// <see cref="InternalServiceCredential.CallbackBaseUrl"/> — must sit beneath it.
/// </remarks>
public static class InternalCallbackPolicy
{
    /// <returns>A refusal message, or null when the URL is acceptable.</returns>
    public static string? Check(InternalApiOptions options, string? callerService, string? callbackUrl)
    {
        if (string.IsNullOrWhiteSpace(callbackUrl)
            || !Uri.TryCreate(callbackUrl, UriKind.Absolute, out var callback)
            || (callback.Scheme != Uri.UriSchemeHttp && callback.Scheme != Uri.UriSchemeHttps))
        {
            return "The callback URL must be an absolute http or https address.";
        }

        if (callerService is null
            || !options.Services.TryGetValue(callerService, out var credential)
            || string.IsNullOrWhiteSpace(credential.CallbackBaseUrl))
        {
            return null;
        }

        if (!Uri.TryCreate(credential.CallbackBaseUrl, UriKind.Absolute, out var allowed))
        {
            return $"The registered callback base URL for {callerService} is not a valid address.";
        }

        var sameOrigin = string.Equals(callback.Scheme, allowed.Scheme, StringComparison.OrdinalIgnoreCase)
                         && string.Equals(callback.Host, allowed.Host, StringComparison.OrdinalIgnoreCase)
                         && callback.Port == allowed.Port;

        // Path prefix on a segment boundary, so "/api/lead-service" does not also admit "/api/lead-service-evil".
        var allowedPath = allowed.AbsolutePath.TrimEnd('/');
        var pathOk = allowedPath.Length == 0
                     || callback.AbsolutePath.Equals(allowedPath, StringComparison.OrdinalIgnoreCase)
                     || callback.AbsolutePath.StartsWith(allowedPath + "/", StringComparison.OrdinalIgnoreCase);

        return sameOrigin && pathOk
            ? null
            : $"{callerService} may only name a callback URL under its registered address.";
    }
}
