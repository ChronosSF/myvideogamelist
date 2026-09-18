using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

public interface IFavouriteService
{
    /// <summary>Every game the user has made a favourite, most recent first.</summary>
    Task<IReadOnlyList<FavouriteDto>> GetFavouritesAsync(
        string userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Makes a game a favourite, and returns when it became one. Idempotent: for a game that already
    /// was one that is the original <c>AddedAt</c>, left alone rather than bumped to now.
    /// </summary>
    Task<DateTimeOffset> AddAsync(string userId, int gameId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Stops a game being a favourite. False when it was not one. Removes nothing else — the entry,
    /// its score and status, and the wishlist are all different axes and are untouched.
    /// </summary>
    Task<bool> RemoveAsync(string userId, int gameId, CancellationToken cancellationToken = default);
}
