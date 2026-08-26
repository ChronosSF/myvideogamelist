using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Reads and writes a user's <see cref="UserGameEntry"/> rows. The status lists are a view over
/// those entries rather than a thing of their own, which is why one service owns both.
/// </summary>
public class ListService(
    ApplicationDbContext db,
    IIgdbService igdbService,
    TimeProvider timeProvider) : IListService
{
    /// <summary>Lowest and highest score the API will store.</summary>
    internal const short MinScore = 1;
    internal const short MaxScore = 10;

    public async Task<ListsDto> GetListsAsync(string userId, CancellationToken cancellationToken = default)
    {
        var statuses = await db.ListStatuses
            .AsNoTracking()
            .OrderBy(s => s.SortOrder)
            .ToListAsync(cancellationToken);

        // Entries with no status are games the user has data about but is not tracking, so they
        // belong to no list.
        var entries = await db.UserGameEntries
            .AsNoTracking()
            .Where(e => e.UserId == userId && e.StatusId != null)
            .OrderBy(e => e.GameId)
            .ToListAsync(cancellationToken);

        // Every status is present even when empty, so the client never guards a missing key.
        if (entries.Count == 0)
            return new ListsDto(statuses.ToDictionary(s => s.Key, _ => (IReadOnlyList<ListEntryDto>)[]));

        var allIds = entries.Select(e => e.GameId).Distinct().ToList();
        var games = (await igdbService.GetGamesByIdsAsync(allIds, cancellationToken))
            .ToDictionary(g => g.Id);

        IReadOnlyList<ListEntryDto> EntriesForStatus(short statusId) =>
            entries
                .Where(e => e.StatusId == statusId)
                .Select(e => games.TryGetValue(e.GameId, out var game) ? ToDto(e, game) : null)
                .OfType<ListEntryDto>()
                .ToList();

        return new ListsDto(statuses.ToDictionary(s => s.Key, s => EntriesForStatus(s.Id)));
    }

    public async Task<ListEntryDto?> GetEntryAsync(
        string userId, int gameId, CancellationToken cancellationToken = default)
    {
        var entry = await db.UserGameEntries
            .AsNoTracking()
            .FirstOrDefaultAsync(e => e.UserId == userId && e.GameId == gameId, cancellationToken);

        if (entry is null) return null;

        var game = (await igdbService.GetGamesByIdsAsync([gameId], cancellationToken)).FirstOrDefault();
        return game is null ? null : ToDto(entry, game);
    }

    public async Task SetListEntryAsync(
        string userId, int gameId, string status, CancellationToken cancellationToken = default)
    {
        var target = await db.ListStatuses
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.Key == status, cancellationToken)
            ?? throw new ArgumentException($"Unknown status: {status}", nameof(status));

        var entry = await FindOrCreateAsync(userId, gameId, cancellationToken);

        // A move to the status the game already holds is not an event. The optimistic-update UI
        // and ordinary double-clicks both send these, and recording them would inflate every
        // count later derived from the log.
        if (entry.StatusId == target.Id) return;

        AppendEvent(userId, gameId, from: entry.StatusId, to: target.Id);
        entry.StatusId = target.Id;
        entry.StatusChangedAt = timeProvider.GetUtcNow();

        // One SaveChanges, so the event and the state change land in the same transaction or
        // neither does. A recorded transition that did not happen is as bad as a missing one.
        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// Takes a game out of every list, keeping the score and everything else on the entry.
    /// Reorganising lists is not a reason to discard a judgement about a game.
    /// </summary>
    public async Task<bool> RemoveListEntryAsync(
        string userId, int gameId, CancellationToken cancellationToken = default)
    {
        var entry = await db.UserGameEntries
            .FirstOrDefaultAsync(e => e.UserId == userId && e.GameId == gameId, cancellationToken);

        // Nothing to do for a game that is already in no list.
        if (entry?.StatusId is null) return false;

        // Leaving every list is a transition too, recorded with no destination.
        AppendEvent(userId, gameId, from: entry.StatusId, to: null);
        entry.StatusId = null;
        entry.StatusChangedAt = timeProvider.GetUtcNow();

        await db.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task SetScoreAsync(
        string userId, int gameId, short? score, CancellationToken cancellationToken = default)
    {
        if (score is not null and (< MinScore or > MaxScore))
            throw new ArgumentOutOfRangeException(
                nameof(score), score, $"Score must be between {MinScore} and {MaxScore}.");

        var entry = await FindOrCreateAsync(userId, gameId, cancellationToken);

        // Scoring a game the user has never listed is legitimate, and creates the entry with no
        // status — the score stands on its own.
        entry.Score = score;

        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// Deletes everything the user has recorded about a game. The only path that discards a score,
    /// and deliberately explicit rather than a side effect of a list change.
    /// </summary>
    public async Task<bool> DeleteEntryAsync(
        string userId, int gameId, CancellationToken cancellationToken = default)
    {
        var entry = await db.UserGameEntries
            .FirstOrDefaultAsync(e => e.UserId == userId && e.GameId == gameId, cancellationToken);

        if (entry is null) return false;

        // Record the departure before the row goes, or the log loses the fact that the game ever
        // left a list. The events themselves survive: they hold no key to this row.
        if (entry.StatusId is not null)
            AppendEvent(userId, gameId, from: entry.StatusId, to: null);

        db.UserGameEntries.Remove(entry);
        await db.SaveChangesAsync(cancellationToken);
        return true;
    }

    /// <summary>
    /// The entry is the user's record of a game, so any operation on it may be the first — scoring
    /// a game that has never been in a list creates the row just as adding it to one does.
    /// </summary>
    private async Task<UserGameEntry> FindOrCreateAsync(
        string userId, int gameId, CancellationToken cancellationToken)
    {
        var existing = await db.UserGameEntries
            .FirstOrDefaultAsync(e => e.UserId == userId && e.GameId == gameId, cancellationToken);

        if (existing is not null) return existing;

        var created = new UserGameEntry
        {
            UserId = userId,
            GameId = gameId,
            AddedAt = timeProvider.GetUtcNow()
        };

        db.UserGameEntries.Add(created);
        return created;
    }

    private static ListEntryDto ToDto(UserGameEntry entry, GameDto game) =>
        new(game, entry.Score, entry.AddedAt, entry.StatusChangedAt);

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
