namespace ModuleRegistry.Domain;

/// <summary>
/// One capability a remote app declares, flattened with its owning sub-module.
/// <para>
/// Kept flat rather than nested because it maps 1:1 onto a <c>RemoteAppCapability</c> row, and the
/// nesting is only needed at the two ends — reading the remote's discovery endpoint and pushing to
/// AuthService — where it is grouped back up.
/// </para>
/// <para>
/// <see cref="ModuleKey"/> is empty for a remote still using the original flat contract, meaning the
/// capability belongs directly to the app rather than to a sub-module.
/// </para>
/// </summary>
/// <param name="Type">
/// What the capability guards, which decides how AuthService delivers it: "Api" capabilities are
/// carried in the JWT for the authorization filters to read, everything else is fetched separately.
/// Defaults to "Api" because every remote that predates the capability manifest declares only
/// endpoint guards, and that is exactly what they have always meant.
/// </param>
/// <param name="GroupKey">
/// Not carried across the wire. AuthService derives it from the key's dotted prefix, so there is one
/// place that decides what grouping means rather than three hops that could disagree.
/// </param>
public record RemoteCapability(
    string ModuleKey,
    string ModuleDisplayName,
    string Key,
    string DisplayName,
    string? Description = null,
    string Type = "Api");
