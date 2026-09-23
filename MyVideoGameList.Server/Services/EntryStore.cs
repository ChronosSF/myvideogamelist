using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// The one way a <see cref="UserGameEntry"/> comes into existence.
/// </summary>
/// <remarks>
/// Extracted from <see cref="ListService"/> unchanged, because it stopped being one service's
/// business the moment a second one needed it: logging a playthrough of a game the user has never
/// listed has to create the entry exactly as scoring one does. Keeping two copies of find-or-create
/// is how a table with a unique index on <c>(UserId, GameId)</c> acquires a path that produces a
/// second row.
/// </remarks>
internal static class EntryStore
{
    /// <summary>
    /// The user's entry for a game, created if this is the first thing recorded about it.
    /// </summary>
    /// <remarks>
    /// Adds to the context without saving — the caller decides what else lands in the same
    /// transaction, which for a status change is the event that has to be written with it.
    /// A newly created entry has no <c>Id</c> until then, so a child must be attached through its
    /// navigation property rather than by copying the key.
    /// </remarks>
    public static async Task<UserGameEntry> FindOrCreateAsync(
        ApplicationDbContext db,
        TimeProvider clock,
        string userId,
        int gameId,
        CancellationToken cancellationToken)
    {
        var existing = await db.UserGameEntries
            .FirstOrDefaultAsync(e => e.UserId == userId && e.GameId == gameId, cancellationToken);

        if (existing is not null) return existing;

        var created = new UserGameEntry
        {
            UserId = userId,
            GameId = gameId,
            AddedAt = clock.GetUtcNow()
        };

        db.UserGameEntries.Add(created);
        return created;
    }

    /// <summary>
    /// The user's entries for many games at once, creating whatever is missing.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Here rather than in the importer so that this stays the only place an entry is born. Calling
    /// <see cref="FindOrCreateAsync"/> in a loop would be six hundred round trips for one import,
    /// and a second hand-rolled find-or-create beside it is how a table with a unique index on
    /// <c>(UserId, GameId)</c> acquires a path that writes a duplicate.
    /// </para>
    /// <para>
    /// Adds without saving, like its single-game counterpart, and says which game ids it created
    /// rather than leaving the caller to work it out — an import needs to know, because only a new
    /// row takes the source's <c>AddedAt</c>. Reported explicitly because the obvious test is
    /// wrong: EF assigns a <em>temporary</em> key when a row is added, so a new entry's <c>Id</c>
    /// is not zero and the caller would silently treat every row as pre-existing.
    /// </para>
    /// </remarks>
    public static async Task<EntrySet> FindOrCreateManyAsync(
        ApplicationDbContext db,
        TimeProvider clock,
        string userId,
        IReadOnlyCollection<int> gameIds,
        CancellationToken cancellationToken)
    {
        var wanted = gameIds.Distinct().ToList();
        if (wanted.Count == 0) return new EntrySet(new Dictionary<int, UserGameEntry>(), new HashSet<int>());

        var found = await db.UserGameEntries
            .Where(e => e.UserId == userId && wanted.Contains(e.GameId))
            .ToDictionaryAsync(e => e.GameId, cancellationToken);

        var now = clock.GetUtcNow();
        var created = new HashSet<int>();

        foreach (var gameId in wanted)
        {
            if (found.ContainsKey(gameId)) continue;

            found[gameId] = new UserGameEntry { UserId = userId, GameId = gameId, AddedAt = now };
            db.UserGameEntries.Add(found[gameId]);
            created.Add(gameId);
        }

        return new EntrySet(found, created);
    }
}

/// <summary>
/// The entries for a set of games, and which of them did not exist a moment ago.
/// </summary>
/// <param name="Created">
/// Game ids this call added to the context. The only reliable way to know: an added row already
/// carries a temporary key, so its <c>Id</c> is not zero and cannot be tested against one.
/// </param>
internal readonly record struct EntrySet(
    IReadOnlyDictionary<int, UserGameEntry> Entries,
    IReadOnlySet<int> Created);
