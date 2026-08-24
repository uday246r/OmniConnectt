namespace EmployeeService.Options;

/// <summary>
/// Bound from the "Internal" config section. The shared static key AuthService must present (via
/// X-Internal-Api-Key) when replaying an approved mutation against this service's own
/// internal/approvals/apply endpoint. Mirrors AuthService's own InternalApiOptions exactly — no shared
/// package, deliberately duplicated per service.
/// </summary>
public class InternalApiOptions
{
    public const string SectionName = "Internal";

    public string ApiKey { get; set; } = string.Empty;
}
