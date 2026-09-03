namespace AuthService.Domain.Entities;

/// <summary>
/// A labelled group of sidebar rows — "Main", "Apps", "System".
/// <para>
/// Seeded rather than hardcoded so the sidebar's shape is data. Before this, the sections and their
/// labels lived in a static C# list, which meant renaming a heading or reordering the sidebar needed
/// a redeploy of the auth service.
/// </para>
/// </summary>
public class NavSection
{
    /// <summary>Stable identifier, also the primary key. Referenced by <see cref="HostNavItem.SectionKey"/>.</summary>
    public required string Key { get; set; }

    /// <summary>What the sidebar renders as the heading. The frontend never supplies its own.</summary>
    public required string Label { get; set; }

    public int SortOrder { get; set; }

    /// <summary>
    /// Pins the section to the bottom of the sidebar.
    /// <para>
    /// A flag rather than a hardcoded key check. The frontend previously tested
    /// <c>section.key === 'system'</c> to apply that styling, which meant the browser had to know one
    /// particular section by name — the last piece of navigation structure still living in the client.
    /// </para>
    /// </summary>
    public bool PinToBottom { get; set; }
}
