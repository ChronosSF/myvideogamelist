using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services.Edge;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// "Start over": every game an account holds deleted, with everything recorded about each, and the
/// account itself kept.
/// </summary>
/// <remarks>
/// <para>
/// <b>What goes and what stays is decided for every user-owned table, and a test holds it so.</b>
/// <see cref="Cleared"/> and <see cref="Kept"/> between them name every table in the export manifest,
/// and <c>LibraryResetTests</c> fails when a table is in neither or in both. A table added later then
/// arrives with this question asked at build time, as ADR 0024 has every table arrive with the
/// export's and the deletion's. What goes is what the library is: the games, everything recorded
/// about them, the wishlist, the favourites, and the event log that the history page and the activity
/// statistics are read from. What stays is the account's own: its tags, its names for the lists, its
/// sort preferences, its import receipts, and the reports it made about other people's words. See
/// <c>docs/decisions/0095-*</c>.
/// </para>
/// <para>
/// <b>Set-based, in one transaction.</b> Nothing is loaded. PostgreSQL's cascades take each entry's
/// playthroughs, review and tag links, and the reports other people made about that review, as they
/// do when one game is deleted. The in-memory provider runs none of this, so it is tested in the
/// integration suite against PostgreSQL (ADR 0057).
/// </para>
/// <para>
/// <b>The four deletes are one statement, so another request's write is taken whole or left
/// whole.</b> Every part of one statement sees the database as it stood when the statement began. A
/// game added in another tab is written with its event in one save, and an import's commit writes its
/// entries, wishlist marks and favourites in one save. As separate statements, such a write could land
/// between two of them: an add between the entries and the events would leave a held game whose
/// <c>manual</c> origin says it has an event behind its status and none (ADR 0026), and an import
/// between the entries and the wishlist would keep its games and lose its marks. As one statement,
/// each such write committed before it is deleted whole, and each committed after it is kept whole.
/// </para>
/// </remarks>
public sealed class LibraryResetService(
    ApplicationDbContext db,
    ProfileWithdrawals withdrawals,
    IMemoryCache cache,
    TimeProvider clock,
    ILogger<LibraryResetService> logger) : ILibraryResetService
{
    /// <summary>
    /// The user-owned tables a start over empties: the library and everything recorded about it.
    /// </summary>
    /// <remarks>
    /// The playthroughs, reviews and tag links go by PostgreSQL's cascade from their entry rather than
    /// by a delete of their own, and are named here because they go all the same.
    /// </remarks>
    internal static readonly IReadOnlySet<Type> Cleared = new HashSet<Type>
    {
        typeof(UserGameEntry),
        typeof(UserGamePlaythrough),
        typeof(Review),
        typeof(UserGameEntryTag),
        typeof(UserWishlistItem),
        typeof(UserFavourite),
        typeof(UserGameEvent),
    };

    /// <summary>
    /// The cleared tables the start over's statement deletes from by name, in the order its parts are
    /// written. Every other cleared table goes by a cascade from one of these, which
    /// <c>LibraryResetTests</c> holds to the model.
    /// </summary>
    internal static readonly IReadOnlyList<Type> DeletedByStatement =
        [typeof(UserGameEvent), typeof(UserGameEntry), typeof(UserWishlistItem), typeof(UserFavourite)];

    /// <summary>
    /// The user-owned tables a start over leaves alone: the account's settings and its records of what
    /// it did elsewhere, none of which is about a game it holds.
    /// </summary>
    /// <remarks>
    /// The tags stay with nothing on them, and the list names and sort preferences as they were, since
    /// neither an import of another tracker's export nor of our own brings them back (ADR 0083). An
    /// import's job and its receipt stay, and a pending job's rows stay to be reviewed, with some of
    /// them selected again (<see cref="ImportService.SelectAgainRowsSkippedForTheLibraryAsync"/>). A
    /// report stays because it is about somebody else's words, not this library.
    /// </remarks>
    internal static readonly IReadOnlySet<Type> Kept = new HashSet<Type>
    {
        typeof(Tag),
        typeof(UserListSetting),
        typeof(UserListSortPreference),
        typeof(ImportJob),
        typeof(ImportRow),
        typeof(ContentReport),
    };

    /// <summary>What the start over's statement deleted, as PostgreSQL counted it.</summary>
    internal sealed class Deleted
    {
        public long Events { get; init; }

        /// <summary>The games whose entries went, which the playthroughs' medians are cached by.</summary>
        public int[] GameIds { get; init; } = [];

        public long Wishlist { get; init; }
        public long Favourites { get; init; }
    }

    public async Task<StartOverResultDto> StartOverAsync(string userId, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();

        // Through the execution strategy, which never retries today, because EF refuses a transaction
        // the application begins under one that does, on the day somebody turns retries on (ADR 0038).
        var strategy = db.Database.CreateExecutionStrategy();

        var (deleted, reselected) = await strategy.ExecuteAsync(async token =>
        {
            await using var transaction = await db.Database.BeginTransactionAsync(token);

            // The pending imports first, while the library can still say which of their rows were
            // skipped because of it.
            var reselected = await ImportService.SelectAgainRowsSkippedForTheLibraryAsync(db, userId, now, token);

            // One statement, for the reason the remarks give. Its parts are DeletedByStatement's, in
            // that order. Run with ToListAsync rather than composed with SingleAsync: EF wraps a
            // composed query in a subquery, and PostgreSQL allows a WITH that modifies data only at
            // the top level.
            var deleted = (await db.Database.SqlQuery<Deleted>($$"""
                WITH "events" AS (DELETE FROM "UserGameEvents" WHERE "UserId" = {{userId}} RETURNING 1),
                     "entries" AS (DELETE FROM "UserGameEntries" WHERE "UserId" = {{userId}} RETURNING "GameId"),
                     "wishlist" AS (DELETE FROM "UserWishlistItems" WHERE "UserId" = {{userId}} RETURNING 1),
                     "favourites" AS (DELETE FROM "UserFavourites" WHERE "UserId" = {{userId}} RETURNING 1)
                SELECT (SELECT count(*) FROM "events") AS "Events",
                       (SELECT coalesce(array_agg("GameId"), '{}') FROM "entries") AS "GameIds",
                       (SELECT count(*) FROM "wishlist") AS "Wishlist",
                       (SELECT count(*) FROM "favourites") AS "Favourites"
                """).ToListAsync(token)).Single();

            // On CancellationToken.None, as every commit that keeps finished work is (ADR 0038 §4). A
            // tab closed before this point rolls the whole of it back, which is a start over that did
            // not happen. Once every statement has returned it has happened, and a token cancelled now
            // would only make Npgsql roll it back unasked and report a failure.
            await transaction.CommitAsync(CancellationToken.None);

            return (deleted, reselected);
        }, cancellationToken);

        // The community medians are cached per game for a few minutes, and dropped by the playthrough
        // service's own writes. These runs went by a cascade, which tells nobody, so this task drops
        // them here, or a median built from runs that no longer exist would be served until it expires.
        foreach (var gameId in deleted.GameIds) cache.Remove(PlaythroughService.CommunityTimesKey(gameId));

        logger.LogInformation(
            "Account {UserId} started over: {Games} games, {Wishlist} wishlisted, {Favourites} favourites "
            + "and {Events} events deleted, {Reselected} pending import rows selected again.",
            userId, deleted.GameIds.Length, deleted.Wishlist, deleted.Favourites, deleted.Events, reselected);

        // Only when a game went, since only an entry can carry a review: a library that was already
        // empty took nothing from the profile. The count is the DELETE's own, so nothing can overtake
        // it, unlike a question asked before the delete (ADR 0058 §1).
        if (deleted.GameIds.Length > 0) await withdrawals.LibraryEmptiedAsync(userId);

        return new StartOverResultDto(
            deleted.GameIds.Length, (int)deleted.Wishlist, (int)deleted.Favourites, reselected);
    }
}
