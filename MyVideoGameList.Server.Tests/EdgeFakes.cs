using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Services.Edge;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// An edge that remembers every invalidation it was handed, in order, and can look at the world at
/// the moment it is handed one.
/// </summary>
internal sealed class RecordingEdgeInvalidator : IEdgeInvalidator
{
    public List<EdgeInvalidation> Sent { get; } = [];

    /// <summary>Run as each invalidation arrives, before anything after the call has happened.</summary>
    public Action<EdgeInvalidation>? OnInvalidate { get; set; }

    public void Invalidate(EdgeInvalidation invalidation)
    {
        Sent.Add(invalidation);
        OnInvalidate?.Invoke(invalidation);
    }
}

/// <summary>An edge whose every call fails, as one would whose implementation had a bug in it.</summary>
internal sealed class ThrowingEdgeInvalidator : IEdgeInvalidator
{
    public int Calls { get; private set; }

    public void Invalidate(EdgeInvalidation invalidation)
    {
        Calls++;
        throw new InvalidOperationException("The edge is not answering.");
    }
}

/// <summary>
/// A logger that keeps what it was told, for the failures whose only effect is a line in the log —
/// which is most of them here, since none may reach the write.
/// </summary>
internal sealed class ListLogger<T> : ILogger<T>
{
    public sealed record Entry(LogLevel Level, string Message, Exception? Exception);

    private readonly List<Entry> entries = [];

    public IReadOnlyList<Entry> Entries
    {
        get { lock (entries) return [.. entries]; }
    }

    public IEnumerable<Entry> At(LogLevel level) => Entries.Where(e => e.Level == level);

    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(
        LogLevel logLevel, EventId eventId, TState state, Exception? exception,
        Func<TState, Exception?, string> formatter)
    {
        lock (entries) entries.Add(new Entry(logLevel, formatter(state, exception), exception));
    }
}

/// <summary>
/// The <see cref="ProfileWithdrawals"/> every service that writes a review or an entry now needs,
/// for the tests that are about something else.
/// </summary>
internal static class EdgeFakes
{
    public static ProfileWithdrawals Withdrawals(ApplicationDbContext db, IEdgeInvalidator? edge = null) =>
        new(db, edge ?? new RecordingEdgeInvalidator(), NullLogger<ProfileWithdrawals>.Instance);
}
