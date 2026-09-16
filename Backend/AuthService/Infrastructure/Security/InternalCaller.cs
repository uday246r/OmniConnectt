namespace AuthService.Infrastructure.Security;

/// <summary>
/// Which service a request to an <c>/internal</c> route came from, as established by
/// <see cref="InternalApiKeyFilter"/> from the key it presented.
/// </summary>
/// <remarks>
/// Null means the caller used the legacy shared key, which identifies nobody. Controllers use this
/// instead of whatever service name the request body claims: once a service is identified by its own
/// key, it can only ever act as itself.
/// </remarks>
public static class InternalCaller
{
    private const string ItemKey = "OmniConnect.InternalCaller";

    public static void Set(HttpContext context, string? serviceName) => context.Items[ItemKey] = serviceName;

    public static string? Get(HttpContext context) => context.Items[ItemKey] as string;
}
