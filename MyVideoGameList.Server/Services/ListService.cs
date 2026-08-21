using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

public class ListService(ApplicationDbContext db, IIgdbService igdbService) : IListService
{
    private static readonly HashSet<string> ValidListTypes = ["playing", "backlog", "finished"];

    public async Task<ListsDto> GetListsAsync(string userId, CancellationToken cancellationToken = default)
    {
        var entries = await db.UserGameLists
            .AsNoTracking()
            .Where(ul => ul.UserId == userId)
            .OrderBy(ul => ul.GameId)
            .ToListAsync(cancellationToken);

        if (entries.Count == 0)
            return new ListsDto([], [], []);

        var allIds = entries.Select(e => e.GameId).Distinct().ToList();
        var games = (await igdbService.GetGamesByIdsAsync(allIds, cancellationToken))
            .ToDictionary(g => g.Id);

        IEnumerable<GameDto> GamesForList(string listType) =>
            entries
                .Where(e => e.ListType == listType)
                .Select(e => games.GetValueOrDefault(e.GameId))
                .OfType<GameDto>();

        return new ListsDto(
            GamesForList("playing"),
            GamesForList("backlog"),
            GamesForList("finished"));
    }

    public async Task SetListEntryAsync(
        string userId, int gameId, string listType, CancellationToken cancellationToken = default)
    {
        if (!IsValidListType(listType))
            throw new ArgumentException($"Invalid list type: {listType}", nameof(listType));

        var existing = await db.UserGameLists
            .FirstOrDefaultAsync(ul => ul.UserId == userId && ul.GameId == gameId, cancellationToken);

        if (existing is not null)
        {
            existing.ListType = listType;
        }
        else
        {
            db.UserGameLists.Add(new UserGameList
            {
                UserId = userId,
                GameId = gameId,
                ListType = listType
            });
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> RemoveListEntryAsync(
        string userId, int gameId, CancellationToken cancellationToken = default)
    {
        var entry = await db.UserGameLists
            .FirstOrDefaultAsync(ul => ul.UserId == userId && ul.GameId == gameId, cancellationToken);

        if (entry is null) return false;

        db.UserGameLists.Remove(entry);
        await db.SaveChangesAsync(cancellationToken);
        return true;
    }

    public static bool IsValidListType(string listType) => ValidListTypes.Contains(listType);
}
