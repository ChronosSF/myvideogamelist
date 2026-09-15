using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// The add and remove behind every per-game axis — the wishlist and the favourites.
/// </summary>
/// <remarks>
/// <para>
/// Extracted from <see cref="WishlistService"/> when the favourites needed the same two writes, for
/// the reason <see cref="EntryStore"/> was extracted from <see cref="ListService"/>: each has a race
/// in it that a double-click or a second tab is enough to hit, and two copies of a race guard is how
/// one of them ends up without it. ADR 0022 records exactly that happening to the two client
/// providers.
/// </para>
/// <para>
/// Scoped by the row's own <see cref="IGameAxisItem.UserId"/> in every predicate. That is the
/// authorization boundary, and writing it once here is what stops a new axis from forgetting it.
/// </para>
/// </remarks>
internal static class GameAxisStore
{
    /// <summary>
    /// Adds the row unless the user already has this game on the axis. False means it was already
    /// there, and the original <c>AddedAt</c> is left alone.
    /// </summary>
    /// <remarks>
    /// Re-adding keeps the original timestamp. An axis is ordered by when the game joined it, and a
    /// double-click should not reorder anybody's list.
    /// </remarks>
    public static async Task<bool> AddAsync<TItem>(
        ApplicationDbContext db, TItem item, CancellationToken cancellationToken)
        where TItem : class, IGameAxisItem
    {
        if (await ExistsAsync<TItem>(db, item.UserId, item.GameId, cancellationToken)) return false;

        db.Set<TItem>().Add(item);

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

            if (await ExistsAsync<TItem>(db, item.UserId, item.GameId, cancellationToken)) return false;
            throw;
        }
    }

    /// <summary>
    /// Takes the game off the axis. False when it was not on it. Removes nothing else.
    /// </summary>
    public static async Task<bool> RemoveAsync<TItem>(
        ApplicationDbContext db, string userId, int gameId, CancellationToken cancellationToken)
        where TItem : class, IGameAxisItem
    {
        var item = await db.Set<TItem>()
            .FirstOrDefaultAsync(i => i.UserId == userId && i.GameId == gameId, cancellationToken);

        if (item is null) return false;

        db.Set<TItem>().Remove(item);

        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateConcurrencyException)
        {
            // Another request deleted the same row between the read and the write. The game is
            // off the axis either way, which is exactly what the caller asked for, so this reports
            // "there was nothing to remove" rather than a 500.
            //
            // Safe to swallow only because the delete is keyed and carries no other change: there
            // is no lost update to worry about, just a row that is already gone.
            return false;
        }
    }

    private static Task<bool> ExistsAsync<TItem>(
        ApplicationDbContext db, string userId, int gameId, CancellationToken cancellationToken)
        where TItem : class, IGameAxisItem =>
        db.Set<TItem>().AnyAsync(i => i.UserId == userId && i.GameId == gameId, cancellationToken);
}
