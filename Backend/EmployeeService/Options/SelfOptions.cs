namespace EmployeeService.Options;

/// <summary>
/// How this service refers to ITSELF when submitting a mutation for approval.
///
/// <see cref="PublicBaseUrl"/> is the address AuthService will call back on to replay an approved
/// change, so it must be reachable from AuthService — not from the browser, and never derived from an
/// incoming request's Host header.
///
/// <see cref="EmployeeModuleKey"/> is the PermissionFeature key this service's employee module is
/// registered under. It has to match the key an administrator sees in Checker Assignment, since that
/// is what decides whether the module is gated at all.
/// </summary>
public class SelfOptions
{
    public const string SectionName = "Self";

    public string PublicBaseUrl { get; set; } = string.Empty;

    public string EmployeeModuleKey { get; set; } = string.Empty;
}
