namespace AuthService.Domain.Entities;

/// <summary>
/// The single row of admin-configurable salutations (Mr., Ms., Dr., ...) offered on the Create/Edit
/// User form and shown on a user's profile — Settings/System > Manage Salutations. Deliberately NOT
/// part of UserFieldSchema: like Role, it's a fixed dropdown every company has, just backed by an
/// editable list of allowed values, rather than a field an admin can add/remove from the form.
/// </summary>
public class SalutationCatalog
{
    public Guid Id { get; set; }
    public required string SalutationsJson { get; set; }
    public int Version { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public Guid? UpdatedBy { get; set; }
}
