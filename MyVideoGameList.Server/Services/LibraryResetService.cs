using Microsoft.EntityFrameworkCore;
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
/// <b>Set-based, in one transaction.</b> One <c>DELETE</c> per table, nothing loaded. PostgreSQL's
/// cascades take each entry's playthroughs, review and tag links, and the reports other people made
/// about that review, as they do when one game is deleted. The in-memory provider runs none of this,
/// so it is tested in the integration suite against PostgreSQL (ADR 0057).
/// </para>
/// <para>
/// <b>The event log is deleted before the entries, and that order is what keeps ADR 0026's rule.</b>
/// A game whose <c>Origin</c> is <c>manual</c> has an event behind every status it has held. A game
/// added in another tab while this runs is written with its event in one save, and each statement
/// here sees what had committed when it began. Deleting the entries first would let that add land
/// between the two statements: its entry would outlive the first statement and its event would not
/// outlive the second, leaving a held game whose status has no event and an origin that says it has.
/// In this order the worst the same race does is the other way round, an event for a game that is no
/// longer held, which deleting a single game leaves on purpose anyway (ADR 0018).
/// </para>
/// </remarks>
public sealed class LibraryResetService(
    ApplicationDbContext db,
    ProfileWithdrawals withdrawals,
    TimeProvider clock,
    ILogger<LibraryResetService> logger) : ILibraryResetService
{
    /// <summary>
    /// The user-owned tables a start over empties: the library and everything recorded about it.
    /// </summary>
    /// <remarks>
    /// The playthroughs, reviews and tag links go by PostgreSQL's cascade from their entry rather than
    /// by a statement of their own, and are named here because they go all the same.
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
    /// The user-owned tables a start over leaves alone: the account's settings and its records of what
    /// it did elsewhere, none of which is about a game it holds.
    /// </summary>
    /// <remarks>
    /// The tags stay with nothing on them, and the list names and sort preferences as they were, since
    /// neither an import of another tracker's export nor of our own brings them back (ADR 0083). An
    /// import's job and its receipt stay, and a pending job's rows stay to be reviewed, with some of
    /// them selected again (<see cref="StartOverAsync"/>). A report stays because it is about somebody
    /// else's words, not this library.
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

    public async Task<StartOverResultDto> StartOverAsync(string userId, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();

        // Through the execution strategy, which never retries today, because EF refuses a transaction
        // the application begins under one that does, on the day somebody turns retries on (ADR 0038).
        var strategy = db.Database.CreateExecutionStrategy();

        var result = await strategy.ExecuteAsync(async token =>
        {
            await using var transaction = await db.Database.BeginTransactionAsync(token);

            // The pending imports first, while the library can still say which of their rows were
            // skipped because of it. An upload sets a matched row to skip only when its game is
            // already held (§S8), and the review cannot tell that skip from one its owner chose for a
            // game they held. Either way the reason was a game this is about to delete, so every such
            // row is selected again, as it would have been had the library been empty at the upload.
            // A row skipped for a game the library does not hold was skipped by its owner, and stays.
            var held = db.UserGameEntries
                .Where(entry => entry.UserId == userId)
                .Select(entry => entry.GameId);

            var reselect = db.ImportRows.Where(row =>
                row.UserId == userId
                && row.MatchKind == ImportMatchKinds.Matched
                && row.Decision == ImportDecisions.Skip
                && row.GameId != null
                && held.Contains(row.GameId.Value)
                && db.ImportJobs.Any(job => job.Id == row.ImportJobId && job.State == ImportJobStates.Pending));

            // Every write to a job stamps it, because its pending window counts from its last saved
            // decision (ADR 0038), and selecting rows again is one.
            await db.ImportJobs
                .Where(job => job.UserId == userId
                    && job.State == ImportJobStates.Pending
                    && reselect.Any(row => row.ImportJobId == job.Id))
                .ExecuteUpdateAsync(set => set.SetProperty(job => job.UpdatedAt, now), token);

            var reselected = await reselect
                .ExecuteUpdateAsync(set => set.SetProperty(row => row.Decision, ImportDecisions.Import), token);

            // The events before the entries: see the remarks for why the order matters.
            var events = await db.UserGameEvents.Where(e => e.UserId == userId).ExecuteDeleteAsync(token);
            var games = await db.UserGameEntries.Where(e => e.UserId == userId).ExecuteDeleteAsync(token);
            var wishlist = await db.UserWishlistItems.Where(w => w.UserId == userId).ExecuteDeleteAsync(token);
            var favourites = await db.UserFavourites.Where(f => f.UserId == userId).ExecuteDeleteAsync(token);

            // On CancellationToken.None, as every commit that keeps finished work is (ADR 0038 §4). A
            // tab closed before this point rolls the whole of it back, which is a start over that did
            // not happen. Once every statement has returned it has happened, and a token cancelled now
            // would only make Npgsql roll it back unasked and report a failure.
            await transaction.CommitAsync(CancellationToken.None);

            return new StartOverResultDto(games, wishlist, favourites, events, reselected);
        }, cancellationToken);

        logger.LogInformation(
            "Account {UserId} started over: {Games} games, {Wishlist} wishlisted, {Favourites} favourites "
            + "and {Events} events deleted, {Reselected} pending import rows selected again.",
            userId, result.Games, result.Wishlist, result.Favourites, result.Events, result.ImportRowsReselected);

        // Only when a game went, since only an entry can carry a review: a library that was already
        // empty took nothing from the profile. The count is the DELETE's own, so nothing can overtake
        // it, unlike a question asked before the delete (ADR 0058 §1).
        if (result.Games > 0) await withdrawals.LibraryEmptiedAsync(userId);

        return result;
    }
}
