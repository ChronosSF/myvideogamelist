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
/// <see cref="GameAxisStore"/>, which the wishlist uses too.
/// </remarks>
public class FavouriteService(
    ApplicationDbContext db,
    IGameCacheService gameCache,
    TimeProvider timeProvider) : IFavouriteService
{
    public async Task<IReadOnlyList<FavouriteDto>> GetFavouritesAsync(
        string userId, CancellationToken cancellationToken = default)
    {
        var items = await db.UserFavourites
            .AsNoTracking()
            .Where(f => f.UserId == userId)
            .OrderByDescending(f => f.AddedAt)
            .ThenBy(f => f.GameId)
            .ToListAsync(cancellationToken);

        if (items.Count == 0) return [];

        var games = (await gameCache.GetGamesAsync(
                items.Select(f => f.GameId).Distinct().ToList(), cancellationToken))
            .ToDictionary(g => g.Id);

        // A game IGDB can no longer resolve is skipped rather than rendered as a hole. The row
        // stays: the id is still the user's data, and IGDB gaps have been transient before.
        return items
            .Select(f => games.TryGetValue(f.GameId, out var game)
                ? new FavouriteDto(game, f.AddedAt)
                : null)
            .OfType<FavouriteDto>()
            .ToList();
    }

    public Task<DateTimeOffset> AddAsync(
        string userId, int gameId, CancellationToken cancellationToken = default) =>
        GameAxisStore.AddAsync(
            db,
            new UserFavourite { UserId = userId, GameId = gameId, AddedAt = timeProvider.GetUtcNow() },
            cancellationToken);

    public Task<bool> RemoveAsync(
        string userId, int gameId, CancellationToken cancellationToken = default) =>
        GameAxisStore.RemoveAsync<UserFavourite>(db, userId, gameId, cancellationToken);
}
