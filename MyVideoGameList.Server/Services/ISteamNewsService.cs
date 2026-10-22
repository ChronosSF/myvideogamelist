using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Per-game news and patch notes sourced from Steam.
/// </summary>
/// <remarks>
/// Every method a page calls degrades to an empty list rather than throwing. News is a garnish: a
/// game with no Steam presence, a rate-limited Steam, or a malformed feed must never take down the
/// page it sits on.
/// </remarks>
public interface ISteamNewsService
{
    /// <summary>
    /// News for a single IGDB game. Empty when the game has no Steam entry, which is the
    /// normal case for console exclusives rather than an error worth surfacing.
    /// </summary>
    Task<IReadOnlyList<NewsItemDto>> GetNewsForGameAsync(
        int igdbGameId, int count = 5, CancellationToken cancellationToken = default);

    /// <summary>
    /// The most recent news across several games, newest first.
    /// </summary>
    /// <param name="maxPerGame">
    /// Caps how many items any single game may contribute. Without it one game mid-tournament
    /// can fill most of an aggregate rail with its own announcements. Null means no cap, which
    /// is what a single-game panel wants.
    /// </param>
    Task<IReadOnlyList<NewsItemDto>> GetLatestNewsAsync(
        IEnumerable<int> igdbGameIds,
        int count = 8,
        int? maxPerGame = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Fetches again, shortly before they expire, the cached feeds somebody has read since they
    /// were fetched, so that the reader who arrives after the expiry does not pay for it.
    /// </summary>
    /// <remarks>
    /// For <c>SteamNewsRefreshService</c>'s timer and nothing else — no page calls it. A feed Steam
    /// fails to answer keeps the copy it has until that expires, and nothing here throws for Steam.
    /// It refreshes this process's own cache only, so every instance runs it for itself (ADR 0052).
    /// </remarks>
    Task RefreshFeedsAsync(CancellationToken cancellationToken = default);
}
