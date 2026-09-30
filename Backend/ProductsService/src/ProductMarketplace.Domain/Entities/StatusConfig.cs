namespace ProductMarketplace.Domain.Entities;

/// <summary>
/// The catalog of valid status values per entity type, plus their display metadata and what each one means.
///
/// This IS the source of truth for which status strings are valid on a real Product, SubCategory or
/// Category record - the entities' Status columns are plain strings, not closed enums, precisely so this
/// catalog can be extended. A row is created once (via StatusConfigService.CreateAsync) and its
/// (EntityType, Value) pair is permanent from then on - only Label/Color/Enabled/IsLive/SortOrder may change
/// afterward, so nothing already using a value can be silently invalidated. Disabling a value only hides
/// it from future selection; existing records keep whatever status they already have.
/// </summary>
public class StatusConfig
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string EntityType { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string Color { get; set; } = string.Empty;

    /// <summary>Whether this status can still be chosen for a record. Says nothing about what a record holding it does.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Whether a record holding this status is live in the catalogue. This is what "active" means: the
    /// catalogue never compares a status to a literal, it asks which statuses are live, so an
    /// administrator can rename Active, or add a second live status, without a deployment.
    /// </summary>
    public bool IsLive { get; set; }

    public int SortOrder { get; set; }
}
