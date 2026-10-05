using Microsoft.Extensions.Logging;

namespace ProductMarketplace.Api.Tests.Fakes;

/// <summary>
/// A hand-written <see cref="ILogger{T}"/> stub. The repo convention is no mocking library, so the
/// engine's logger dependency is satisfied by this instead of a framework double.
/// </summary>
/// <remarks>
/// Entries are captured so a test can assert that a silently-tolerated condition (an unknown
/// operator, a legacy scoring shape) was at least reported rather than swallowed.
/// </remarks>
public sealed class FakeLogger<T> : ILogger<T>
{
    private readonly List<string> entries = [];

    public IReadOnlyList<string> Entries => entries;

    public IDisposable BeginScope<TState>(TState state) where TState : notnull => new NoopScope();

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
        Func<TState, Exception?, string> formatter)
    {
        entries.Add($"{logLevel}: {formatter(state, exception)}");
    }

    private sealed class NoopScope : IDisposable
    {
        public void Dispose() { }
    }
}
