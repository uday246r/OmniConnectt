namespace backend.Options;

/// <summary>
/// Bound from the "Self" config section. This service's own externally-reachable base URL, handed to
/// AuthService as the CallbackUrl on every gated Field Settings mutation submitted for approval, and
/// the keys it files approvals under.
/// </summary>
public class SelfOptions
{
    public const string SectionName = "Self";

    public string PublicBaseUrl { get; set; } = string.Empty;

    /// <summary>The key this app was registered under in Setup → Applications.</summary>
    public string AppKey { get; set; } = "customer360";

    private string? _fieldSettingsModuleKey;

    /// <summary>
    /// The PermissionFeature key Field Settings approvals are filed under. Defaults to
    /// <c>remote.{AppKey}.fieldsettings</c>, so an unset value no longer turns every gating check into a
    /// request for module "" (which AuthService cannot answer, so the change was refused with a 503).
    /// </summary>
    public string FieldSettingsModuleKey
    {
        get => string.IsNullOrWhiteSpace(_fieldSettingsModuleKey) ? $"remote.{AppKey.ToLowerInvariant()}.fieldsettings" : _fieldSettingsModuleKey;
        set => _fieldSettingsModuleKey = value;
    }
}
