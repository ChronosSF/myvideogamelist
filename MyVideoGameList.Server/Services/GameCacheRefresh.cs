using System.Linq.Expressions;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Which cached games the background refresh asks IGDB about next, and when it counts as behind.
/// </summary>
/// <remarks>
/// <para>
/// Separated from <see cref="GameCacheRefreshService"/> for the reason <c>ImportRetention</c> is
/// separated from its sweep: the <em>decision</em> is testable while the plumbing is not. The
/// predicates are expressions rather than delegates, so the job translates them to SQL and the
/// tests run the identical expressions against the in-memory provider.
/// </para>
/// <para>
/// <b>A tombstone is selected like any other row</b> (ADR 0035). It records that IGDB had no such
/// game when last asked, and that is as perishable as any answer: a game withdrawn and restored,
/// or an id asked about a moment before IGDB published it, comes back to life only by being asked
/// again. <see cref="DueAt"/> reads nothing but <see cref="CachedGame.RefreshedAt"/>, which is what
/// keeps it that way.
/// </para>
/// </remarks>
internal static class GameCacheRefresh
{
    /// <summary>
    /// How long before a reader would refresh a row the job refreshes it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The issue that asked for this job says it refreshes rows "past a day old", and its point is
    /// that no page load pays the round trip that today falls on whoever arrives first after
    /// expiry. Those two do not quite agree: a day old is exactly when a reader's own request
    /// refreshes the row (<see cref="GameCacheService.RefreshAfter"/>), so a job that waited for it
    /// would leave every row to the next reader for up to one interval. Looking ahead closes that.
    /// </para>
    /// <para>
    /// An hour, because it has to cover a backlog as well as an interval. Rows written together
    /// fall due together — a cold shelf of five hundred games is one write — and at the default
    /// pace the job works through 3,000 of them in an hour, so a burst that size is still refreshed
    /// before any of it reaches a reader. The cost is that a row is rewritten every twenty-three
    /// hours rather than twenty-four: four percent more requests, against a budget the job uses
    /// under half of one percent of.
    /// </para>
    /// </remarks>
    public static readonly TimeSpan Lead = TimeSpan.FromHours(1);

    /// <summary>
    /// How old a row is when it becomes the job's to refresh.
    /// </summary>
    public static readonly TimeSpan DueAfter = GameCacheService.RefreshAfter - Lead;

    /// <summary>
    /// How old a row may get before the refresh counts as behind, and says so.
    /// </summary>
    /// <remarks>
    /// An hour past the age at which readers start refreshing rows themselves — two hours after the
    /// job should have reached it. A burst can push the tail of the queue past
    /// <see cref="GameCacheService.RefreshAfter"/> for a while, and that costs those readers what
    /// they paid before this job existed; a row still waiting an hour later is not a burst, but a
    /// job that cannot take its lock, cannot reach IGDB, or cannot keep up.
    /// </remarks>
    public static readonly TimeSpan OverdueAfter = GameCacheService.RefreshAfter + TimeSpan.FromHours(1);

    /// <summary>The rows the job should refresh at <paramref name="now"/>.</summary>
    /// <remarks>
    /// "At or past", as <see cref="GameCacheService"/> reads its own interval, so that the two
    /// thresholds differ only by <see cref="Lead"/>.
    /// </remarks>
    public static Expression<Func<CachedGame, bool>> DueAt(DateTimeOffset now)
    {
        var refreshedBy = now - DueAfter;
        return game => game.RefreshedAt <= refreshedBy;
    }

    /// <summary>The rows that say the refresh is behind at <paramref name="now"/>.</summary>
    public static Expression<Func<CachedGame, bool>> OverdueAt(DateTimeOffset now)
    {
        var refreshedBy = now - OverdueAfter;
        return game => game.RefreshedAt <= refreshedBy;
    }

    /// <summary>
    /// The next batch: at most <paramref name="batchSize"/> due rows, the longest-waiting first.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Oldest first, as the issue asks and as <c>IX_CachedGames_RefreshedAt</c> was added to serve
    /// (ADR 0035), so a job that cannot keep up leaves behind the rows that waited least — and a
    /// reader who meets one of those pays exactly what they paid before it existed.
    /// </para>
    /// <para>
    /// Ties broken on the id, which matters more than it looks: every row written by one request
    /// shares one <see cref="CachedGame.RefreshedAt"/>, so without it a five-hundred-row shelf would
    /// come back in whatever order the database liked, and <c>Take</c> over an undefined order can
    /// return a different fifty from the same table.
    /// </para>
    /// </remarks>
    public static IQueryable<CachedGame> NextBatch(
        IQueryable<CachedGame> games, DateTimeOffset now, int batchSize) =>
        games
            .Where(DueAt(now))
            .OrderBy(game => game.RefreshedAt)
            .ThenBy(game => game.GameId)
            .Take(batchSize);
}
