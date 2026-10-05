namespace AuthService.Domain.Entities;

/// <summary>
/// The single row holding the platform's password policy — how long a password lives (globally and per
/// role), the complexity rules a new password must satisfy, and when/where users are warned before it
/// expires. Managed on Settings &gt; Manage Password Policy.
/// <para>
/// Same shape as the other catalogs: the JSON is a plain string (parsing is the service's job),
/// <see cref="Version"/> is an EF concurrency token so two administrators cannot silently overwrite each
/// other, and there is one row, deliberately not multi-tenant.
/// </para>
/// <para>
/// Until an administrator first saves, this row does not exist and the service falls back to a default
/// built from the <c>PasswordPolicy</c> appsettings section. So a deployment that tightened those values
/// keeps enforcing them; from the first save onwards this row is the authority.
/// </para>
/// </summary>
public class PasswordPolicyCatalog
{
    public Guid Id { get; set; }
    public required string PolicyJson { get; set; }
    public int Version { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public Guid? UpdatedBy { get; set; }
}
