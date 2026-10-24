using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// A log provider that keeps what it is given, scopes included, so that a test can ask what a line
/// would have carried rather than what the console made of it.
/// </summary>
/// <remarks>
/// The scopes come from the logger factory's own provider, which is where the trace id of the
/// current activity is added: asking for the scopes is asking what every real provider is handed.
/// </remarks>
internal sealed class RecordingLoggerProvider : ILoggerProvider, ISupportExternalScope
{
    private IExternalScopeProvider scopes = new LoggerExternalScopeProvider();

    public ConcurrentQueue<Entry> Entries { get; } = new();

    public ILogger CreateLogger(string categoryName) => new Logger(this, categoryName);

    public void SetScopeProvider(IExternalScopeProvider scopeProvider) => scopes = scopeProvider;

    public void Dispose()
    {
    }

    /// <summary>One line: who wrote it, what it said, its named values and the scopes around it.</summary>
    internal sealed record Entry(
        string Category,
        LogLevel Level,
        string Message,
        IReadOnlyList<KeyValuePair<string, object?>> State,
        IReadOnlyList<KeyValuePair<string, object?>> Scopes)
    {
        public object? Value(string key) => State.FirstOrDefault(pair => pair.Key == key).Value;

        public string? Scope(string key) =>
            Scopes.Where(pair => pair.Key == key).Select(pair => pair.Value?.ToString()).FirstOrDefault();
    }

    private sealed class Logger(RecordingLoggerProvider provider, string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull =>
            provider.scopes.Push(state);

        public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            var scopes = new List<KeyValuePair<string, object?>>();
            provider.scopes.ForEachScope(static (scope, list) =>
            {
                if (scope is IEnumerable<KeyValuePair<string, object?>> pairs) list.AddRange(pairs);
            }, scopes);

            provider.Entries.Enqueue(new Entry(
                category,
                logLevel,
                formatter(state, exception),
                state as IReadOnlyList<KeyValuePair<string, object?>> ?? [],
                scopes));
        }
    }
}
