using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>The games the admin pinned to the Coming soon panel, and the ones hidden from it.</summary>
public sealed record ComingSoonPicks(IReadOnlySet<int> Pinned, IReadOnlySet<int> Hidden);

/// <summary>
/// The home page's Coming soon panel (ADR 0071), in the two steps the home composite takes it in.
/// </summary>
/// <remarks>
/// Two steps rather than one because the composite runs its parts at once and only one of them may use the
/// request's database context: the picks are read first, on their own, and the composing — which asks IGDB
/// and nothing of ours — runs beside the rest.
/// </remarks>
public interface IComingSoonService
{
    Task<ComingSoonPicks> GetPicksAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// The panel for <paramref name="today"/>, a UTC day. Throws when IGDB cannot be asked; the caller
    /// decides what a failure costs.
    /// </summary>
    Task<IReadOnlyList<ComingSoonDto>> ComposeAsync(
        DateOnly today, ComingSoonPicks picks, CancellationToken cancellationToken = default);
}
