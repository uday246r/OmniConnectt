namespace AuthService.Domain.Enums;

/// <summary>
/// Where a permission-catalog entry came from. Host features are seeded once at startup;
/// RemoteApp features are written at runtime by RemoteAppAppService whenever an
/// admin registers/updates/removes a remote app — never hardcoded here.
/// </summary>
public enum PermissionFeatureSource
{
    Host = 0,
    RemoteApp = 1,
}
