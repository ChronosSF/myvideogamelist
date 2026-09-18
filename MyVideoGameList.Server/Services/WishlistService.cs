using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Reads and writes <see cref="UserWishlistItem"/> rows.
/// </summary>
/// <remarks>
/// A service of its own rather than more methods on <see cref="ListService"/>, because the
/// wishlist shares nothing with the status lists but the game id: no status, no score, no event
/// log, and no <see cref="UserGameEntry"/> row required. Folding it in would have meant a service
/// whose name described half of what it did.
/// </remarks>
public class WishlistService(
    ApplicationDbContext db,
    IIgdbService igdbService,
    TimeProvider timeProvider) : IWishlistService
{
    public async Task<IReadOnlyList<WishlistItemDto>> GetWishlistAsync(
        string userId, CancellationToken cancellationToken = default)
    {
        var items = await db.UserWishlistItems
            .AsNoTracking()
            .Where(w => w.UserId == userId)
            .OrderByDescending(w => w.AddedAt)
            // As the favourites are: two rows written at the same moment — which a library import
            // would write a whole wishlist of — would otherwise come back in no particular order,
            // and in a different one each time.
            .ThenBy(w => w.GameId)
            .ToListAsync(cancellationToken);

        if (items.Count == 0) return [];

        var games = (await igdbService.GetGamesByIdsAsync(
                items.Select(w => w.GameId).Distinct().ToList(), cancellationToken))
            .ToDictionary(g => g.Id);

        // A game IGDB can no longer resolve is skipped rather than rendered as a hole. The row
        // stays: the id is still the user's data, and IGDB gaps have been transient before.
        return items
            .Select(w => games.TryGetValue(w.GameId, out var game)
                ? new WishlistItemDto(game, w.AddedAt)
                : null)
            .OfType<WishlistItemDto>()
            .ToList();
    }

    /// <remarks>
    /// The race between two adds of the same game is handled in <see cref="GameAxisStore"/>, which
    /// the favourites share, so the guard cannot be fixed for one axis and missed on the other.
    /// </remarks>
    public Task<DateTimeOffset> AddAsync(
        string userId, int gameId, CancellationToken cancellationToken = default) =>
        GameAxisStore.AddAsync(
            db,
            new UserWishlistItem { UserId = userId, GameId = gameId, AddedAt = timeProvider.GetUtcNow() },
            cancellationToken);

    public Task<bool> RemoveAsync(
        string userId, int gameId, CancellationToken cancellationToken = default) =>
        GameAxisStore.RemoveAsync<UserWishlistItem>(db, userId, gameId, cancellationToken);
}
