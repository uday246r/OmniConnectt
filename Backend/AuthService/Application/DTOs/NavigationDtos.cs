namespace AuthService.Application.DTOs;

/// <summary>
/// The entire sidebar, already filtered for the calling user. The host renders this verbatim — it
/// holds no navigation structure of its own, and nothing here is decided in the browser.
/// </summary>
public record NavigationResponseDto(
    /// <summary>Changes whenever anything the tree is built from changes. Drives the ETag.</summary>
    string Version,
    DateTimeOffset GeneratedAt,
    IReadOnlyList<NavSectionDto> Sections);

/// <summary>
/// A labelled group of rows. Sections come from the database, so the host hardcodes neither their
/// labels nor their keys.
/// </summary>
public record NavSectionDto(
    string Key,
    string Label,
    int Order,
    /// <summary>Pins the section to the bottom of the sidebar, so the frontend need not know any section by name.</summary>
    bool PinToBottom,
    IReadOnlyList<NavNodeDto> Items);

/// <summary>One row. Children are its sub-pages; the host renders the chevron when there are any.</summary>
public record NavNodeDto(
    /// <summary>Stable React key and active-route id. Not always a feature key — one feature can own several rows.</summary>
    string Key,
    string Label,
    /// <summary>Resolved to a component by the host's icon registry; an unknown or null key falls back to a neutral default.</summary>
    string? IconKey,
    /// <summary>Absolute host route, e.g. "/system/audit-logs", "/apps/lead", "/apps/lead/view-lead".</summary>
    string RoutePath,
    /// <summary>The page name handed to the remote as a prop. Null for host rows and for an app's own root.</summary>
    string? Page,
    int Order,
    /// <summary>"host" | "remote-app" | "submodule".</summary>
    string Kind,
    /// <summary>
    /// "visible" | "maintenance" | "maintenance-bypass" (in maintenance, and this caller may open it
    /// anyway). There is deliberately no "forbidden" or "hidden": a row the caller
    /// must not see is absent from the array entirely, because emitting it would ship the whole
    /// product's module list to every browser.
    /// </summary>
    string State,
    string? MaintenanceMessage,
    /// <summary>Present only for a remote-app row — everything the host needs to mount the container.</summary>
    RemoteMountDto? Remote,
    /// <summary>Always present, never null, so the host never has to branch on it.</summary>
    IReadOnlyList<NavNodeDto> Children);

public record RemoteMountDto(
    string AppKey,
    /// <summary>
    /// Null while the app is in maintenance for a caller who may not bypass it: there is nothing for
    /// them to load, so the server does not tell them where the build lives.
    /// </summary>
    string? ManifestUrl,
    string? ContainerName,
    /// <summary>Where /apps/{key} should land — the first row the caller can actually see.</summary>
    string? DefaultRoutePath);
