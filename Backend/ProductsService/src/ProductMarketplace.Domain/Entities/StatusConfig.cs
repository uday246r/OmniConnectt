namespace ProductMarketplace.Domain.Entities;

/// <summary>
/// The catalog of valid status values per entity type, plus their display metadata.
///
/// This IS the source of truth for which status strings are valid on a real Product/Category/
/// Review/Promotion/Application record - the entities' Status columns are plain strings, not
/// closed enums, precisely so this catalog can be extended. A row is created once (via
/// StatusConfigService.CreateAsync) and its (EntityType, Value) pair is permanent from then on -
/// only Label/Color/Enabled/SortOrder may change afterward, so nothing already using a value can
/// be silently invalidated. Disabling a value only hides it from future selection; existing
/// records keep whatever status they already have.
/// </summary>
public class StatusConfig
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string EntityType { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string Color { get; set; } = "neutral";
    public bool Enabled { get; set; } = true;
    public int SortOrder { get; set; }
}
