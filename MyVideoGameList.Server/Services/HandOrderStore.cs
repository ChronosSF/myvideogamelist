using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// The write behind every hand-arranged order: the backlog's, the favourites showcase's, and anything
/// ordered the same way after them.
/// </summary>
/// <remarks>
/// <para>
/// Here rather than in <see cref="ListService"/> for the reason <see cref="GameAxisStore"/> is shared
/// by two axes: every list arranged by hand calls this rather than a copy of it — the backlog through
/// <see cref="ListService"/>, the favourites through <see cref="FavouriteService"/> — and with it the
/// two things below that are easy to leave out of a copy.
/// </para>
/// <para>
/// It stores what it is given. Which numbers go where is the client's decision (ADR 0054), checked on
/// the way in by <see cref="PositionDto"/>'s range — the same split ADR 0020 made for every other sort,
/// where the server keeps the choice and the client does the ordering.
/// </para>
/// </remarks>
internal static class HandOrderStore
{
    /// <summary>
    /// How many times a write is retried after a row it was about to write was deleted underneath it.
    /// Each retry has one more row out of the way, so one is nearly always enough; the bound is there
    /// so a pathological run of deletions ends in an error rather than a loop.
    /// </summary>
    private const int MaxAttempts = 3;

    /// <summary>
    /// Puts each named game at its position, among the rows of <paramref name="list"/> that belong to
    /// <paramref name="userId"/>, and returns how many it wrote.
    /// </summary>
    /// <param name="list">
    /// The list being arranged — for the backlog, the entries whose status is Backlog. Narrowed here
    /// to the user's own rows whatever the caller passed, so a caller that forgot the user in its own
    /// predicate still cannot write anybody else's.
    /// </param>
    /// <remarks>
    /// <para>
    /// A game that is not in the list is passed over. It was there when the client last looked, and
    /// has since been moved out — by another tab, or by a write this one has not heard back from — and
    /// a place in a list is not something to keep for a game that has left it.
    /// </para>
    /// <para>
    /// A row deleted between the read and the write is passed over too, rather than turned into a 500.
    /// The save that finds it is rolled back whole, so it is retried without that row; anything else
    /// that fails the save is rethrown.
    /// </para>
    /// </remarks>
    public static async Task<int> WriteAsync<TRow>(
        ApplicationDbContext db,
        IQueryable<TRow> list,
        string userId,
        IReadOnlyCollection<PositionDto> positions,
        CancellationToken cancellationToken)
        where TRow : class, IHandOrdered
    {
        // The last word on each game, for a body that names one twice.
        var wanted = new Dictionary<int, int>();
        foreach (var position in positions) wanted[position.GameId] = position.Position;

        var gameIds = wanted.Keys.ToList();
        var rows = await list
            .Where(row => row.UserId == userId && gameIds.Contains(row.GameId))
            .ToListAsync(cancellationToken);

        foreach (var row in rows) row.Position = wanted[row.GameId];

        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await db.SaveChangesAsync(cancellationToken);
                return rows.Count;
            }
            catch (DbUpdateConcurrencyException conflict) when (attempt < MaxAttempts)
            {
                // Only the rows the database could not find. They are no longer in the list at all,
                // so there is nothing to put back; the rest are still marked modified, and are saved
                // again on the next pass.
                foreach (var gone in conflict.Entries)
                {
                    if (gone.Entity is TRow row) rows.Remove(row);
                    gone.State = EntityState.Detached;
                }
            }
        }
    }
}
