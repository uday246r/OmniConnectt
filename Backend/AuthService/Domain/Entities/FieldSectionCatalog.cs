namespace AuthService.Domain.Entities;

/// <summary>
/// The single row holding the admin-managed list of form sections — the headings that group fields on
/// the Create/Edit User form, the user detail page and the Manage Fields screen.
/// <para>
/// A field references its section by the section's stable <c>Key</c>, never by its label. That is the
/// whole point of this catalog: when sections were a free-text string on each field, renaming one
/// orphaned every field still carrying the old spelling. Now the label is display-only and can change
/// at will while the key — and therefore every field's placement — stays put.
/// </para>
/// Same shape as the other catalogs: the JSON is a plain string (parsing is the service's job), and
/// <see cref="Version"/> is an EF concurrency token so two administrators cannot silently overwrite
/// each other. One row, deliberately not multi-tenant, matching UserFieldSchema.
/// </summary>
public class FieldSectionCatalog
{
    public Guid Id { get; set; }
    public required string SectionsJson { get; set; }
    public int Version { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public Guid? UpdatedBy { get; set; }
}
