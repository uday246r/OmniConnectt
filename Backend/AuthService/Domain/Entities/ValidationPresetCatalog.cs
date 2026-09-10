namespace AuthService.Domain.Entities;

/// <summary>
/// The single row of admin-defined, reusable validation "formats" — Settings > Manage Formats. These
/// are ADDITIONAL to the fixed, code-defined preset catalog (letters only, email, etc. — see
/// FieldPresets.cs); an admin creates one here to name and reuse a regex, a character-length range, or
/// a numeric-value range across any field in UserFieldSchema, without retyping a raw pattern into every
/// field that needs it. Unlike the built-in catalog, every preset here is fully admin-owned: it can be
/// edited or deleted freely, because none of them carry special hardcoded logic (like the "smart
/// email" near-miss check) the way a couple of the built-in ones do.
/// </summary>
public class ValidationPresetCatalog
{
    public Guid Id { get; set; }
    public required string PresetsJson { get; set; }
    public int Version { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public Guid? UpdatedBy { get; set; }
}
