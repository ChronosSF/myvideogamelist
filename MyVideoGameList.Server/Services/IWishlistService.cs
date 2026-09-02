using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

public interface IWishlistService
{
    /// <summary>Everything the user has wishlisted, most recently wanted first.</summary>
    Task<IReadOnlyList<WishlistItemDto>> GetWishlistAsync(
        string userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Adds a game to the wishlist. Idempotent: false means it was already there, and the
    /// original <c>AddedAt</c> is left alone rather than being bumped to now.
    /// </summary>
    Task<bool> AddAsync(string userId, int gameId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Takes a game off the wishlist. False when it was not on it. Removes nothing else — the
    /// user's entry, score and status are a different axis and are untouched.
    /// </summary>
    Task<bool> RemoveAsync(string userId, int gameId, CancellationToken cancellationToken = default);
}
