namespace ProductMarketplace.Domain.Entities;

/// <summary>
/// Immutable record of a significant action taken within the Product Marketplace
/// (admin mutation, customer search, product view, application decision, etc).
/// Powers the Audit Logs screen and its real-time feed.
/// </summary>
public class AuditLog
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;

    /// <summary>The platform user id from the verified token. Null for rows written before sign-in was enforced.</summary>
    public Guid? ActorUserId { get; set; }

    public string ActorName { get; set; } = "System";
    public string ActorEmail { get; set; } = string.Empty;

    /// <summary>Machine key for the action, e.g. "product.status_change".</summary>
    public string Action { get; set; } = string.Empty;
    /// <summary>Domain entity the action relates to, e.g. "Product".</summary>
    public string EntityType { get; set; } = string.Empty;
    public Guid? EntityId { get; set; }
    public string EntityName { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;
    public bool Success { get; set; } = true;

    public string? PreviousValue { get; set; }
    public string? NewValue { get; set; }
    public string? IpAddress { get; set; }
}
