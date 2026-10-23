using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>Keeps every line written, for a test to read what a service said about itself.</summary>
internal sealed class RecordingLogger<T> : ILogger<T>
{
    private readonly ConcurrentQueue<Entry> entries = new();

    public sealed record Entry(LogLevel Level, string Message, Exception? Exception);

    public IReadOnlyList<Entry> Entries => entries.ToArray();

    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(
        LogLevel logLevel,
        EventId eventId,
        TState state,
        Exception? exception,
        Func<TState, Exception?, string> formatter) =>
        entries.Enqueue(new Entry(logLevel, formatter(state, exception), exception));
}
