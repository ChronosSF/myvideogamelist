using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

public interface IFavouriteService
{
    /// <summary>
    /// Every game the user has made a favourite, in their showcase's order: those they placed by hand
    /// first, then the rest most recent first.
    /// </summary>
    Task<IReadOnlyList<FavouriteDto>> GetFavouritesAsync(
        string userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Makes a game a favourite, and returns when it became one and where it stands. Idempotent: for a
    /// game that already was one that is the original <c>AddedAt</c>, left alone rather than bumped to
    /// now, and the position it already had.
    /// </summary>
    Task<FavouriteAddedDto> AddAsync(string userId, int gameId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Stops a game being a favourite. False when it was not one. Removes nothing else — the entry,
    /// its score and status, and the wishlist are all different axes and are untouched.
    /// </summary>
    Task<bool> RemoveAsync(string userId, int gameId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Puts some of the user's favourites where they have arranged them in their showcase. A game that
    /// is not a favourite is passed over; every favourite not named keeps its position. Records no
    /// event. See <c>IHandOrdered</c>.
    /// </summary>
    Task SetPositionsAsync(
        string userId,
        IReadOnlyCollection<PositionDto> positions,
        CancellationToken cancellationToken = default);
}
