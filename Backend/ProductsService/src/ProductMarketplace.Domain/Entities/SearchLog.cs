namespace ProductMarketplace.Domain.Entities;

/// <summary>Records a normalized search term each time a customer searches products, powering the real "Top Searches" dashboard widget.</summary>
public class SearchLog
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Term { get; set; } = string.Empty;
    public int HitCount { get; set; } = 1;
    public DateTime LastSearchedAt { get; set; } = DateTime.UtcNow;
}
