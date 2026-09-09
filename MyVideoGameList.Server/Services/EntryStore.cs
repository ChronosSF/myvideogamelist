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
}
