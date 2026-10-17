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
    IGameCacheService gameCache,
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
        var games = (await gameCache.GetGamesAsync(allIds, cancellationToken))
            .ToDictionary(g => g.Id);

        IReadOnlyList<ListEntryDto> EntriesForStatus(short statusId) =>
            entries
                .Where(e => e.StatusId == statusId)
                .Select(e => games.TryGetValue(e.GameId, out var game) ? ToDto(e, game) : null)
                .OfType<ListEntryDto>()
                .ToList();

        return new ListsDto(statuses.ToDictionary(s => s.Key, s => EntriesForStatus(s.Id)));
    }

    public async Task<EntryDto?> GetEntryAsync(
        string userId, int gameId, CancellationToken cancellationToken = default)
    {
        var entry = await db.UserGameEntries
            .AsNoTracking()
            .FirstOrDefaultAsync(e => e.UserId == userId && e.GameId == gameId, cancellationToken);

        if (entry is null) return null;

        var game = (await gameCache.GetGamesAsync([gameId], cancellationToken)).FirstOrDefault();
        return game is null ? null : new EntryDto(ToDto(entry, game), entry.Notes);
    }

    public async Task<EntryStateDto> SetListEntryAsync(
        string userId, int gameId, string status, CancellationToken cancellationToken = default)
    {
        var target = await StatusIdAsync(status, cancellationToken);
        var entry = await FindOrCreateAsync(userId, gameId, cancellationToken);

        // One SaveChanges, so the event and the state change land in the same transaction or
        // neither does. A recorded transition that did not happen is as bad as a missing one.
        if (Transition(entry, target, timeProvider.GetUtcNow()) is not null)
            await db.SaveChangesAsync(cancellationToken);

        return new EntryStateDto(entry.Score, entry.Ownership, entry.AddedAt, entry.StatusChangedAt, entry.Position);
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
        Transition(entry, to: null, timeProvider.GetUtcNow());

        await db.SaveChangesAsync(cancellationToken);
        return true;
    }

    /// <summary>
    /// How many times a change of status to several games is saved again after a row it was about
    /// to write was deleted underneath it — <see cref="HandOrderStore"/>'s bound, for its reason: one
    /// retry nearly always has the row out of the way, and a pathological run of deletions should end
    /// in an error rather than a loop.
    /// </summary>
    private const int MaxBatchAttempts = 3;

    /// <summary>
    /// Moves several of the user's games to one list, or out of every list, as one transaction with
    /// an event for each game whose status changed (ADR 0055).
    /// </summary>
    /// <remarks>
    /// <para>
    /// Every game goes through <see cref="Transition"/>, the rule each single move and removal goes
    /// through too, so a batch is the moves it names and nothing else: an event per change, none for a
    /// game already where it was asked to be, a hand-order place cleared by a change of list. Every
    /// change shares one moment, so the games a batch brings into a list arrive together and are told
    /// apart by title, on the server as on the client.
    /// </para>
    /// <para>
    /// It acts on the user's own entries and creates none — the selection it serves is made of games in
    /// the user's lists, and a single move's find-or-create is not a path to thousands of new rows. A
    /// game with no entry is answered <see cref="StatusChangeOutcomes.Missing"/> for a move and
    /// <see cref="StatusChangeOutcomes.Unchanged"/> for a removal, which it has already had. Scoped to
    /// the user in the read's own predicate, so an id that is somebody else's game is the same answer.
    /// </para>
    /// <para>
    /// One <c>SaveChanges</c>: every change and every event land together or none does. A row deleted
    /// between the read and the save — "delete my data" from another tab — is passed over and answered
    /// as if it had been missing all along, its event dropped with it, and the rest are saved again, as
    /// <see cref="HandOrderStore"/> does rather than a 500.
    /// </para>
    /// </remarks>
    public async Task<IReadOnlyList<StatusChangeDto>> SetStatusesAsync(
        string userId,
        IReadOnlyCollection<int> gameIds,
        string? status,
        CancellationToken cancellationToken = default)
    {
        short? target = status is null ? null : await StatusIdAsync(status, cancellationToken);

        var wanted = gameIds.Distinct().ToList();
        var entries = await db.UserGameEntries
            .Where(e => e.UserId == userId && wanted.Contains(e.GameId))
            .ToDictionaryAsync(e => e.GameId, cancellationToken);

        // What a game with no entry has had done to it: a removal it was never in a list for, and a
        // move that did not happen.
        var absent = target is null ? StatusChangeOutcomes.Unchanged : StatusChangeOutcomes.Missing;

        var now = timeProvider.GetUtcNow();
        var outcomes = new Dictionary<int, string>();
        var events = new Dictionary<int, UserGameEvent>();

        foreach (var gameId in wanted)
        {
            if (!entries.TryGetValue(gameId, out var entry))
            {
                outcomes[gameId] = absent;
                continue;
            }

            var recorded = Transition(entry, target, now);
            if (recorded is null)
            {
                outcomes[gameId] = StatusChangeOutcomes.Unchanged;
                continue;
            }

            events[gameId] = recorded;
            outcomes[gameId] = StatusChangeOutcomes.Moved;
        }

        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await db.SaveChangesAsync(cancellationToken);
                break;
            }
            // Only a conflict made of entries is a row gone missing. Anything else — an event named, which
            // PostgreSQL cannot produce today — is rethrown rather than detached, since dropping an event
            // while saving its entry's change is the status change without an event 0018 forbids.
            catch (DbUpdateConcurrencyException conflict)
                when (attempt < MaxBatchAttempts && conflict.Entries.All(gone => gone.Entity is UserGameEntry))
            {
                // Only the rows the database could not find, and the events that would have recorded
                // their moves. The save that found them was rolled back whole; the rest are still
                // marked, and go again.
                foreach (var gone in conflict.Entries)
                {
                    var entry = (UserGameEntry)gone.Entity;
                    if (events.Remove(entry.GameId, out var orphan))
                        db.Entry(orphan).State = EntityState.Detached;
                    outcomes[entry.GameId] = absent;
                    gone.State = EntityState.Detached;
                }
            }
        }

        return wanted.Select(gameId => new StatusChangeDto(gameId, outcomes[gameId])).ToList();
    }

    /// <summary>
    /// Places some of the games in one of the user's lists where they have arranged them by hand.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Scoped to the list as well as to the user: a game that has left it since the client last
    /// looked is passed over, so a stale tab does not give a Playing game a place in the backlog's
    /// order. Records no event — an order is not a status transition — and creates no entry, since
    /// a game in a list already has one.
    /// </para>
    /// <para>
    /// The scope is checked when the rows are read, not in the update, which goes by key. A move out
    /// of the list landing in the moment between the two leaves the game a number in a list it has
    /// left: nothing reads a position outside its own list, and the next change of list clears it.
    /// Closing that would take an <c>UPDATE</c> with the status in its predicate, which the in-memory
    /// provider the tests run on cannot execute — not worth it for a number nobody sees (ADR 0054).
    /// </para>
    /// </remarks>
    public async Task SetPositionsAsync(
        string userId,
        string status,
        IReadOnlyCollection<PositionDto> positions,
        CancellationToken cancellationToken = default)
    {
        var statusId = await StatusIdAsync(status, cancellationToken);

        await HandOrderStore.WriteAsync(
            db,
            db.UserGameEntries.Where(e => e.StatusId == statusId),
            userId,
            positions,
            cancellationToken);
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

    /// <summary>The ownership values the column accepts, which is its check constraint's list too.</summary>
    internal static readonly IReadOnlySet<string> OwnershipValues = new HashSet<string>
    {
        OwnershipKinds.Owned,
        OwnershipKinds.Subscription,
        OwnershipKinds.Borrowed
    };

    public async Task SetOwnershipAsync(
        string userId, int gameId, string? ownership, CancellationToken cancellationToken = default)
    {
        // The DTO has already refused anything else; this refuses it too, as SetScoreAsync refuses
        // a score out of range, so that no caller can reach the check constraint and a 500.
        if (ownership is not null && !OwnershipValues.Contains(ownership))
            throw new ArgumentException($"Unknown ownership: {ownership}", nameof(ownership));

        var entry = await EntryToWriteAsync(userId, gameId, create: ownership is not null, cancellationToken);
        if (entry is null) return;

        entry.Ownership = ownership;
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task SetNotesAsync(
        string userId, int gameId, string? notes, CancellationToken cancellationToken = default)
    {
        // Blank is no notes, as it is for a playthrough's: a note of three spaces is not something
        // anybody meant to keep.
        var trimmed = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();

        var entry = await EntryToWriteAsync(userId, gameId, create: trimmed is not null, cancellationToken);
        if (entry is null) return;

        entry.Notes = trimmed;
        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// The entry one of its own fields is about to be written to: created when there is a value to
    /// hold, and only looked up when the write is a clear.
    /// </summary>
    /// <remarks>
    /// Clearing a field on a game with no entry is answered without a write. Creating a row to hold
    /// a null would leave a statusless entry recording nothing at all, and it would switch on the
    /// game page's "delete my data" for a game the user has said nothing about. Scoring keeps its
    /// older behaviour and creates the row either way. No event in any case: none of these is a
    /// status transition.
    /// </remarks>
    private async Task<UserGameEntry?> EntryToWriteAsync(
        string userId, int gameId, bool create, CancellationToken cancellationToken) =>
        create
            ? await FindOrCreateAsync(userId, gameId, cancellationToken)
            : await db.UserGameEntries
                .FirstOrDefaultAsync(e => e.UserId == userId && e.GameId == gameId, cancellationToken);

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
            AppendEvent(userId, gameId, from: entry.StatusId, to: null, timeProvider.GetUtcNow());

        db.UserGameEntries.Remove(entry);
        await db.SaveChangesAsync(cancellationToken);
        return true;
    }

    /// <summary>
    /// The entry is the user's record of a game, so any operation on it may be the first — scoring
    /// a game that has never been in a list creates the row just as adding it to one does.
    /// </summary>
    /// <remarks>
    /// Shared with <see cref="PlaythroughService"/> through <see cref="EntryStore"/>, because
    /// logging a playthrough of a never-listed game has to create the entry the same way.
    /// </remarks>
    private Task<UserGameEntry> FindOrCreateAsync(
        string userId, int gameId, CancellationToken cancellationToken) =>
        EntryStore.FindOrCreateAsync(db, timeProvider, userId, gameId, cancellationToken);

    /// <summary>The seeded id of a status key.</summary>
    /// <exception cref="ArgumentException">The key is not one of the seeded statuses.</exception>
    private async Task<short> StatusIdAsync(string status, CancellationToken cancellationToken) =>
        await db.ListStatuses
            .AsNoTracking()
            .Where(s => s.Key == status)
            .Select(s => (short?)s.Id)
            .FirstOrDefaultAsync(cancellationToken)
        ?? throw new ArgumentException($"Unknown status: {status}", nameof(status));

    /// <summary>
    /// Moves one entry to a status, or out of every list for null, and records that it did: the one
    /// rule a single move, a single removal and a batch all go through, so none of them can drift
    /// from the others (ADR 0018, ADR 0055).
    /// </summary>
    /// <returns>The event recorded, or null when the entry already held that status.</returns>
    /// <remarks>
    /// A move to the status the game already holds is not an event. The optimistic-update UI and
    /// ordinary double-clicks both send these, and recording them would inflate every count later
    /// derived from the log. Adds to the context without saving: the caller saves the event with the
    /// change it records, in one transaction.
    /// </remarks>
    private UserGameEvent? Transition(UserGameEntry entry, short? to, DateTimeOffset now)
    {
        if (entry.StatusId == to) return null;

        var recorded = AppendEvent(entry.UserId, entry.GameId, from: entry.StatusId, to: to, now);
        entry.StatusId = to;
        entry.StatusChangedAt = now;

        // A place in the old list's hand order is no place in the new one, so the game arrives
        // unplaced — at the end of the list it joins, like any other arrival. See IHandOrdered.
        entry.Position = null;

        return recorded;
    }

    private static ListEntryDto ToDto(UserGameEntry entry, GameDto game) =>
        new(game, entry.Score, entry.Ownership, entry.AddedAt, entry.StatusChangedAt, entry.Position);

    private UserGameEvent AppendEvent(string userId, int gameId, short? from, short? to, DateTimeOffset occurredAt) =>
        db.UserGameEvents.Add(new UserGameEvent
        {
            UserId = userId,
            GameId = gameId,
            FromStatusId = from,
            ToStatusId = to,
            OccurredAt = occurredAt
        }).Entity;
}
