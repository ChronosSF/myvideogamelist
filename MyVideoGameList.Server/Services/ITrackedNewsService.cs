using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Steam news for the games one user tracks.
/// </summary>
/// <remarks>
/// Degrades to an empty list rather than throwing, as <see cref="ISteamNewsService"/> does: a user
/// with no Steam games, a Steam outage and an IGDB outage all come back as nothing to show.
/// </remarks>
public interface ITrackedNewsService
{
    /// <summary>
    /// The most recent news across the user's lists and wishlist, newest first, with no one game
    /// allowed to fill it.
    /// </summary>
    Task<IReadOnlyList<NewsItemDto>> GetNewsAsync(string userId, CancellationToken cancellationToken = default);
}
