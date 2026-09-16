namespace LeadManagement.Api.Options;

/// <summary>
/// Bound from the "Self" config section. This service's own externally-reachable base URL, handed to
/// AuthService as the CallbackUrl on every gated Lead mutation submitted for approval, and the keys it
/// files approvals under.
/// </summary>
public class SelfOptions
{
    public const string SectionName = "Self";

    public string PublicBaseUrl { get; set; } = string.Empty;

    /// <summary>
    /// The key this app was registered under in Setup → Applications. Every module key below derives from
    /// it, so registering the app under a different key needs only this one value changed.
    /// </summary>
    public string AppKey { get; set; } = "lead";

    private string? _leadModuleKey;
    private string? _fieldSettingsModuleKey;

    /// <summary>
    /// The PermissionFeature key approvals for leads are filed under. Defaults to
    /// <c>remote.{AppKey}.lead</c> — the key AuthService derives from this service's own
    /// <c>[RequiresCapability("Lead", ...)]</c> attributes.
    /// </summary>
    /// <remarks>
    /// This had no default. With it unset — as it was in the local configuration — every non-administrator
    /// lead change asked AuthService whether module "" was gated, got a 404, and was refused with a 503
    /// "approval service unavailable" instead of being created or held for approval.
    /// </remarks>
    public string LeadModuleKey
    {
        get => string.IsNullOrWhiteSpace(_leadModuleKey) ? $"remote.{AppKey.ToLowerInvariant()}.lead" : _leadModuleKey;
        set => _leadModuleKey = value;
    }

    /// <summary>Same idea as <see cref="LeadModuleKey"/>, for Field Settings, which gates independently.</summary>
    public string FieldSettingsModuleKey
    {
        get => string.IsNullOrWhiteSpace(_fieldSettingsModuleKey) ? $"remote.{AppKey.ToLowerInvariant()}.fieldsettings" : _fieldSettingsModuleKey;
        set => _fieldSettingsModuleKey = value;
    }
}
