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

        var item = new UserWishlistItem
        {
            UserId = userId,
            GameId = gameId,
            AddedAt = timeProvider.GetUtcNow()
        };
        db.UserWishlistItems.Add(item);

        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException)
        {
            // Two requests can both pass the check above — a double-click, or two tabs — and only
            // one insert can win the composite primary key. A PUT is idempotent, so losing that
            // race is success, not a 500.
            //
            // Confirmed by re-reading rather than by matching a provider-specific SQL state, so
            // this stays correct on any provider and rethrows anything that is not this race.
            db.Entry(item).State = EntityState.Detached;

            var wonByAnotherRequest = await db.UserWishlistItems
                .AnyAsync(w => w.UserId == userId && w.GameId == gameId, cancellationToken);

            if (wonByAnotherRequest) return false;
            throw;
        }
    }

    public async Task<bool> RemoveAsync(
        string userId, int gameId, CancellationToken cancellationToken = default)
    {
        var item = await db.UserWishlistItems
            .FirstOrDefaultAsync(w => w.UserId == userId && w.GameId == gameId, cancellationToken);

        if (item is null) return false;

        db.UserWishlistItems.Remove(item);

        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateConcurrencyException)
        {
            // Another request deleted the same row between the read and the write. The game is
            // off the wishlist either way, which is exactly what the caller asked for, so this
            // reports "there was nothing to remove" rather than a 500.
            //
            // Safe to swallow only because the delete is keyed and carries no other change: there
            // is no lost update to worry about, just a row that is already gone.
            return false;
        }
    }
}
