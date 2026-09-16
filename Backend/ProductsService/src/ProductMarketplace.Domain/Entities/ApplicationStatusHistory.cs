namespace ProductMarketplace.Domain.Entities;

public class ApplicationStatusHistory
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ApplicationId { get; set; }
    public Application Application { get; set; } = null!;

    public string Status { get; set; } = string.Empty;
    public string Note { get; set; } = string.Empty;
    public DateTime ChangedAt { get; set; } = DateTime.UtcNow;
}
