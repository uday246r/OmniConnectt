namespace AuthService.Domain.Enums;

/// <summary>
/// What kind of thing a capability guards.
/// <para>
/// This is metadata, not policy — nothing enforces differently because of it. It exists for two
/// reasons: the permission editor groups and filters by it instead of showing one undifferentiated
/// list, and it decides <b>where a capability is delivered</b>.
/// </para>
/// <para>
/// <b>The delivery rule, which is load-bearing:</b> only <see cref="Api"/> capabilities travel in the
/// JWT's <c>perms</c> claim. Those are the ones the four existing authorization filters read from the
/// claim, so they must stay exactly where they are. Every other type is fetched and cached instead,
/// which is what keeps the token from growing without bound as remotes declare hundreds of UI
/// capabilities. A test asserts this invariant directly.
/// </para>
/// </summary>
public enum CapabilityType
{
    /// <summary>
    /// Guards an API endpoint, discovered by reflection from a <c>[RequiresCapability]</c> attribute.
    /// This is every capability that exists today, and the only kind carried in the JWT.
    /// </summary>
    Api = 0,

    /// <summary>A page region or control that is not an endpoint in its own right.</summary>
    Ui = 1,

    /// <summary>A dashboard widget or KPI card.</summary>
    Widget = 2,

    /// <summary>A chart or analytics visualisation.</summary>
    Chart = 3,

    /// <summary>Downloading or exporting data.</summary>
    Export = 4,

    /// <summary>An operation applied to many records at once.</summary>
    BulkAction = 5,

    /// <summary>A discrete business action that is not covered by the types above.</summary>
    Action = 6,
}
