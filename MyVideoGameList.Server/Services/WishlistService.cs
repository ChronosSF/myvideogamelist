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

    public async Task<bool> AddAsync(
        string userId, int gameId, CancellationToken cancellationToken = default)
    {
        var exists = await db.UserWishlistItems
            .AnyAsync(w => w.UserId == userId && w.GameId == gameId, cancellationToken);

        // Re-adding keeps the original timestamp. The wishlist is ordered by when someone started
        // wanting a game, and a double-click should not reorder their list.
        if (exists) return false;

        db.UserWishlistItems.Add(new UserWishlistItem
        {
            UserId = userId,
            GameId = gameId,
            AddedAt = timeProvider.GetUtcNow()
        });

        await db.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<bool> RemoveAsync(
        string userId, int gameId, CancellationToken cancellationToken = default)
    {
        var item = await db.UserWishlistItems
            .FirstOrDefaultAsync(w => w.UserId == userId && w.GameId == gameId, cancellationToken);

        if (item is null) return false;

        db.UserWishlistItems.Remove(item);
        await db.SaveChangesAsync(cancellationToken);
        return true;
    }
}
