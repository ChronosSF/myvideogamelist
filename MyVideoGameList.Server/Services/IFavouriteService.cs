using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

public interface IFavouriteService
{
    /// <summary>Every game the user has made a favourite, most recent first.</summary>
    Task<IReadOnlyList<FavouriteDto>> GetFavouritesAsync(
        string userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Makes a game a favourite. Idempotent: false means it already was one, and the original
    /// <c>AddedAt</c> is left alone rather than being bumped to now.
    /// </summary>
    Task<bool> AddAsync(string userId, int gameId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Stops a game being a favourite. False when it was not one. Removes nothing else — the entry,
    /// its score and status, and the wishlist are all different axes and are untouched.
    /// </summary>
    Task<bool> RemoveAsync(string userId, int gameId, CancellationToken cancellationToken = default);
}
