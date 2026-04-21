using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

public class ListService(ApplicationDbContext db, IIgdbService igdbService) : IListService
{
    private static readonly HashSet<string> ValidListTypes = ["playing", "backlog", "finished"];

    public async Task<ListsDto> GetListsAsync(string userId)
    {
        var entries = await db.UserGameLists
            .Where(ul => ul.UserId == userId)
            .ToListAsync();

        if (entries.Count == 0)
            return new ListsDto([], [], []);

        var allIds = entries.Select(e => e.GameId).Distinct().ToList();
        var games = (await igdbService.GetGamesByIdsAsync(allIds))
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

    public async Task SetListEntryAsync(string userId, int gameId, string listType)
    {
        if (!IsValidListType(listType))
            throw new ArgumentException($"Invalid list type: {listType}", nameof(listType));

        var existing = await db.UserGameLists
            .FirstOrDefaultAsync(ul => ul.UserId == userId && ul.GameId == gameId);

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

        await db.SaveChangesAsync();
    }

    public async Task<bool> RemoveListEntryAsync(string userId, int gameId)
    {
        var entry = await db.UserGameLists
            .FirstOrDefaultAsync(ul => ul.UserId == userId && ul.GameId == gameId);

        if (entry is null) return false;

        db.UserGameLists.Remove(entry);
        await db.SaveChangesAsync();
        return true;
    }

    public static bool IsValidListType(string listType) => ValidListTypes.Contains(listType);
}
