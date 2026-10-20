using System.Collections.Concurrent;
using MyVideoGameList.Server.Services.Edge;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// The CDN, as far as the test host has one: what the API asked it to forget, in order.
/// </summary>
/// <remarks>
/// With no distribution id the application's own invalidator only logs (ADR 0058), which says
/// nothing a test could read back. Kept for the whole class, so a test reads what arrived after
/// its own count rather than all of it.
/// </remarks>
public sealed class RecordingEdge : IEdgeInvalidator
{
    private readonly ConcurrentQueue<EdgeInvalidation> sent = new();

    public IReadOnlyList<EdgeInvalidation> Sent => sent.ToArray();

    public IReadOnlyList<EdgeInvalidation> SentSince(int count) => [.. sent.Skip(count)];

    public void Invalidate(EdgeInvalidation invalidation) => sent.Enqueue(invalidation);
}
