using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Reads and writes <see cref="UserFavourite"/> rows.
/// </summary>
/// <remarks>
/// A service of its own, as the wishlist has, because a favourite shares nothing with the status
/// lists but the game id (ADR 0022 §5 and ADR 0029). The two writes go through
/// <see cref="GameAxisStore"/>, which the wishlist uses too, and the hand order's through
/// <see cref="HandOrderStore"/>, which the backlog uses.
/// </remarks>
public class FavouriteService(
    ApplicationDbContext db,
    IGameCacheService gameCache,
    TimeProvider timeProvider) : IFavouriteService
{
    /// <summary>
    /// The showcase's order, which both reads of the showcase use — the owner's here and the public
    /// profile's in <see cref="PublicProfileService"/>: the favourites placed by hand first, by their
    /// positions, then the rest newest first, and the game id breaking whatever is left. The export
    /// reads oldest first, as every section of it does, and the positions travel as they are.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Newest first is the order every favourite was shown in before there was a hand order (ADR 0029
    /// §6), so a showcase nobody has arranged reads exactly as it did, and a favourite made today shows
    /// right after the ones placed by hand rather than at the far end of the row. A backlog queues its
    /// unplaced games the other way, oldest first, because a backlog is a queue and a showcase is not
    /// (ADR 0064).
    /// </para>
    /// <para>
    /// "No position" is put after every position explicitly rather than left to the database:
    /// PostgreSQL sorts nulls last on an ascending key and the in-memory provider the tests run on sorts
    /// them first. The id is the last word because two rows can share a timestamp — an import writes a
    /// whole axis with one — and the order has to be the same on every read for a client to plan a move
    /// against it.
    /// </para>
    /// </remarks>
    internal static IOrderedQueryable<UserFavourite> InShowcaseOrder(IQueryable<UserFavourite> favourites) =>
        favourites
            .OrderBy(f => f.Position == null)
            .ThenBy(f => f.Position)
            .ThenByDescending(f => f.AddedAt)
            .ThenBy(f => f.GameId);

    public async Task<IReadOnlyList<FavouriteDto>> GetFavouritesAsync(
        string userId, CancellationToken cancellationToken = default)
    {
        var items = await InShowcaseOrder(db.UserFavourites
                .AsNoTracking()
                .Where(f => f.UserId == userId))
            .ToListAsync(cancellationToken);

        if (items.Count == 0) return [];

        var games = (await gameCache.GetGamesAsync(
                items.Select(f => f.GameId).Distinct().ToList(), cancellationToken))
            .ToDictionary(g => g.Id);

        // A game IGDB can no longer resolve is skipped rather than rendered as a hole. The row
        // stays: the id is still the user's data, and IGDB gaps have been transient before.
        return items
            .Select(f => games.TryGetValue(f.GameId, out var game)
                ? new FavouriteDto(game, f.AddedAt, f.Position)
                : null)
            .OfType<FavouriteDto>()
            .ToList();
    }

    public async Task<FavouriteAddedDto> AddAsync(
        string userId, int gameId, CancellationToken cancellationToken = default)
    {
        var addedAt = await GameAxisStore.AddAsync(
            db,
            new UserFavourite { UserId = userId, GameId = gameId, AddedAt = timeProvider.GetUtcNow() },
            cancellationToken);

        // Read after the add rather than taken from it, because the store answers for every axis and
        // only this one has a place: null for a favourite made now, and for one another tab made and
        // placed first, that place — which the tab asking has no other way to learn.
        var position = await db.UserFavourites
            .AsNoTracking()
            .Where(f => f.UserId == userId && f.GameId == gameId)
            .Select(f => f.Position)
            .FirstOrDefaultAsync(cancellationToken);

        return new FavouriteAddedDto(addedAt, position);
    }

    public Task<bool> RemoveAsync(
        string userId, int gameId, CancellationToken cancellationToken = default) =>
        GameAxisStore.RemoveAsync<UserFavourite>(db, userId, gameId, cancellationToken);

    /// <remarks>
    /// The whole axis is the list, so the only game passed over is one that is not a favourite — taken
    /// off since the client last looked, in another tab or by a removal this one has not heard back
    /// from. No row is made for it: a position is a place in the showcase, and a game that has left it
    /// has none. The store scopes to the user in its own predicate.
    /// </remarks>
    public Task SetPositionsAsync(
        string userId,
        IReadOnlyCollection<PositionDto> positions,
        CancellationToken cancellationToken = default) =>
        HandOrderStore.WriteAsync(db, db.UserFavourites, userId, positions, cancellationToken);
}
