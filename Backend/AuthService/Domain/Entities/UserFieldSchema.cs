namespace AuthService.Domain.Entities;

/// <summary>
/// The single row describing which fields the Create/Edit User form collects beyond Role and Status
/// (which are never part of this schema — see UserSchemaValidator's doc comment for why), and what
/// validation each one enforces. Edited by an admin through the "Manage User Fields" screen; read by
/// the frontend to render the form and by UserAppService to re-validate every submission server-side.
///
/// One row today (no CompanyId column yet — this is deliberately not multi-tenant), matching the
/// current single-company scope. SchemaJson is the array of FieldDefinition objects serialized as
/// JSON, stored as a Postgres jsonb column (see AuthDbContext.OnModelCreating).
/// </summary>
public class UserFieldSchema
{
    public Guid Id { get; set; }
    public required string SchemaJson { get; set; }
    public int Version { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public Guid? UpdatedBy { get; set; }
}
