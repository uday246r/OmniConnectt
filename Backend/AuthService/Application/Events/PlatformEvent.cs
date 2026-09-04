namespace AuthService.Application.Events;

/// <summary>
/// Wire contract matching frontend InvalidationTopic and PlatformEventPayload.
/// Server pushes { topic, action?, data? } to clients over the /hubs/platform SignalR connection.
/// </summary>
public record PlatformEvent(string Topic, string? Action = null, object? Data = null);
