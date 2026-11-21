using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Which of a game's playthroughs is the unfinished one a move asks about (ADR 0097).
/// </summary>
/// <remarks>
/// <para>
/// Unfinished means no finish date, and nothing else: a run has no outcome of its own, so a run nobody
/// finished and a run its owner gave up on look the same. That is why only a move to Playing or to
/// Finished asks anything.
/// </para>
/// <para>
/// A game can have several, because runs logged by hand may overlap and nothing forbids it. The one a
/// move means is the one started most recently; where none says when it started, the one logged most
/// recently. A dated run is taken over an undated one, because a date is what the question shows.
/// </para>
/// <para>
/// Read by <see cref="ListService"/> to answer a move, which writes no run (ADR 0025 §4), and by
/// <see cref="PlaythroughService"/>, whose start refuses while one exists. One rule in one place, so the
/// run a move reports is the run a finish is asked of.
/// </para>
/// </remarks>
internal static class UnfinishedPlaythroughs
{
    /// <summary>
    /// The user's unfinished playthrough of the game that a move means, or null when every run is
    /// finished or there is none.
    /// </summary>
    /// <remarks>
    /// Ordered in memory rather than in SQL, as <see cref="PlaythroughService.GetForGameAsync"/> orders
    /// its rows and for its reason: PostgreSQL and the in-memory provider the tests run on sort nulls at
    /// opposite ends, and a game has a handful of runs.
    /// </remarks>
    public static async Task<UnfinishedPlaythroughDto?> LatestAsync(
        ApplicationDbContext db, string userId, int gameId, CancellationToken cancellationToken)
    {
        var unfinished = await db.UserGamePlaythroughs
            .AsNoTracking()
            // Scoped on the playthrough's own UserId, which is the authorization boundary.
            .Where(p => p.UserId == userId && p.Entry.GameId == gameId && p.FinishedOn == null)
            .Select(p => new { p.Id, p.StartedOn, p.CreatedAt })
            .ToListAsync(cancellationToken);

        return unfinished
            .OrderByDescending(p => p.StartedOn.HasValue)
            .ThenByDescending(p => p.StartedOn)
            .ThenByDescending(p => p.CreatedAt)
            .ThenByDescending(p => p.Id)
            .Select(p => new UnfinishedPlaythroughDto(p.Id, p.StartedOn))
            .FirstOrDefault();
    }

    /// <summary>Whether the user has any unfinished playthrough of the game.</summary>
    public static Task<bool> AnyAsync(
        ApplicationDbContext db, string userId, int gameId, CancellationToken cancellationToken) =>
        db.UserGamePlaythroughs
            .AnyAsync(p => p.UserId == userId && p.Entry.GameId == gameId && p.FinishedOn == null, cancellationToken);
}
