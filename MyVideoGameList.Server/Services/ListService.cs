using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

public class ListService(
    ApplicationDbContext db,
    IIgdbService igdbService,
    TimeProvider timeProvider) : IListService
{
    public async Task<ListsDto> GetListsAsync(string userId, CancellationToken cancellationToken = default)
    {
        var statuses = await db.ListStatuses
            .AsNoTracking()
            .OrderBy(s => s.SortOrder)
            .ToListAsync(cancellationToken);

        var entries = await db.UserGameLists
            .AsNoTracking()
            .Where(ul => ul.UserId == userId)
            .OrderBy(ul => ul.GameId)
            .ToListAsync(cancellationToken);

        // Every status is present even when empty, so the client never guards a missing key.
        if (entries.Count == 0)
            return new ListsDto(statuses.ToDictionary(s => s.Key, _ => (IReadOnlyList<GameDto>)[]));

        var allIds = entries.Select(e => e.GameId).Distinct().ToList();
        var games = (await igdbService.GetGamesByIdsAsync(allIds, cancellationToken))
            .ToDictionary(g => g.Id);

        IReadOnlyList<GameDto> GamesForStatus(short statusId) =>
            entries
                .Where(e => e.StatusId == statusId)
                .Select(e => games.GetValueOrDefault(e.GameId))
                .OfType<GameDto>()
                .ToList();

        return new ListsDto(statuses.ToDictionary(s => s.Key, s => GamesForStatus(s.Id)));
    }

    public async Task SetListEntryAsync(
        string userId, int gameId, string status, CancellationToken cancellationToken = default)
    {
        var target = await db.ListStatuses
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.Key == status, cancellationToken)
            ?? throw new ArgumentException($"Unknown status: {status}", nameof(status));

        var existing = await db.UserGameLists
            .FirstOrDefaultAsync(ul => ul.UserId == userId && ul.GameId == gameId, cancellationToken);

        if (existing is not null)
        {
            // A move to the status the game already holds is not an event. The optimistic-update
            // UI and ordinary double-clicks both send these, and recording them would inflate
            // every count later derived from the log.
            if (existing.StatusId == target.Id) return;

            AppendEvent(userId, gameId, from: existing.StatusId, to: target.Id);
            existing.StatusId = target.Id;
        }
        else
        {
            AppendEvent(userId, gameId, from: null, to: target.Id);
            db.UserGameLists.Add(new UserGameList
            {
                UserId = userId,
                GameId = gameId,
                StatusId = target.Id
            });
        }

        // One SaveChanges, so the event and the state change land in the same transaction or
        // neither does. A recorded transition that did not happen is as bad as a missing one.
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> RemoveListEntryAsync(
        string userId, int gameId, CancellationToken cancellationToken = default)
    {
        var entry = await db.UserGameLists
            .FirstOrDefaultAsync(ul => ul.UserId == userId && ul.GameId == gameId, cancellationToken);

        if (entry is null) return false;

        // Leaving tracking altogether is a transition too, recorded with no destination.
        AppendEvent(userId, gameId, from: entry.StatusId, to: null);

        db.UserGameLists.Remove(entry);
        await db.SaveChangesAsync(cancellationToken);
        return true;
    }

    private void AppendEvent(string userId, int gameId, short? from, short? to) =>
        db.UserGameEvents.Add(new UserGameEvent
        {
            UserId = userId,
            GameId = gameId,
            FromStatusId = from,
            ToStatusId = to,
            OccurredAt = timeProvider.GetUtcNow()
        });
}
