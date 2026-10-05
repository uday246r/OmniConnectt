namespace ProductMarketplace.Application.Dtos;

public class StatusConfigDto
{
    public Guid Id { get; set; }
    public string EntityType { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string Color { get; set; } = string.Empty;
    public bool Enabled { get; set; }

    /// <summary>Whether a record holding this status is live in the catalogue.</summary>
    public bool IsLive { get; set; }

    public int SortOrder { get; set; }
}

/// <summary>Update only ever touches display metadata and meaning - EntityType and Value are immutable once
/// a row exists (via Create), so nothing here can desynchronize a status value already in use on real
/// records.</summary>
public class StatusConfigUpdateDto
{
    public string Label { get; set; } = string.Empty;
    public string Color { get; set; } = string.Empty;
    public bool Enabled { get; set; } = true;
    public bool IsLive { get; set; }
    public int SortOrder { get; set; }
}

/// <summary>Creates a brand-new status value for an entity type. Once created, the (EntityType,
/// Value) pair is permanent - only Update may touch it thereafter.</summary>
public class StatusConfigCreateDto
{
    public string EntityType { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string Color { get; set; } = string.Empty;
    public bool Enabled { get; set; } = true;
    public bool IsLive { get; set; }
    public int SortOrder { get; set; }
}
