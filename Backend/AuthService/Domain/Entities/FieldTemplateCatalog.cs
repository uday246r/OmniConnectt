namespace AuthService.Domain.Entities;

/// <summary>
/// The single row of admin-configurable, reusable field templates (e.g. Country dropdown with all countries,
/// Department, Employment Type, Gender, etc.) stored in the database.
/// Allows administrators to manage, add, or remove dropdown options dynamically, and create their own custom templates.
/// </summary>
public class FieldTemplateCatalog
{
    public Guid Id { get; set; }
    public required string TemplatesJson { get; set; }
    public int Version { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public Guid? UpdatedBy { get; set; }
}
