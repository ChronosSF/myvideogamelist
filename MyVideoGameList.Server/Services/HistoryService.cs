using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// The kinds of thing the history lists, as the numbers they sort by and the keys the API sends.
/// </summary>
/// <remarks>
/// The numbers order items that share a moment, newest first, so that a run started and finished on
/// the same day reads with its finish above its start. They never reach the client except inside an
/// encrypted cursor; the keys do, and they are permanent once sent.
/// </remarks>
internal static class HistoryKinds
{
    public const int PlaythroughStarted = 1;
    public const int PlaythroughFinished = 2;
    public const int Status = 3;
    public const int Score = 4;

    public static bool IsKnown(int kind) => kind is >= PlaythroughStarted and <= Score;

    public static string Key(int kind) => kind switch
    {
        PlaythroughStarted => "playthrough_started",
        PlaythroughFinished => "playthrough_finished",
        Status => "status",
        Score => "score",
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "Not a history kind.")
    };

    /// <summary>Whether an item of this kind is a calendar day rather than an instant.</summary>
    public static bool IsDated(int kind) => kind is PlaythroughStarted or PlaythroughFinished;
}

/// <summary>
/// The signed-in user's history: status changes, scores and playthrough dates, as one list read
/// from their own rows at query time.
/// </summary>
/// <remarks>
/// <para>
/// <b>A union, not a log.</b> <c>UserGameEvents</c> records status transitions and nothing else,
/// by design (ADR 0018): a playthrough writes no event (ADR 0025 §4) and neither does a score (ADR
/// 0019). So this reads each kind from the row that records it — the event for a move, the entry's
/// <see cref="UserGameEntry.ScoredAt"/> for a score, a playthrough's own dates for a run — and
/// unions them in one query, the shape <c>docs/data-model-plan.md</c> gives the activity feed. No
/// event type is added and no row is written to make an item exist. See ADR 0062.
/// </para>
/// <para>
/// <b>What has no moment has no item.</b> An imported status has no event behind it (ADR 0026 §2),
/// a score given before <see cref="UserGameEntry.ScoredAt"/> existed has none either, and neither is
/// placed somewhere plausible. The page is told how many of each there are instead, read from
/// <see cref="UserGameEntry.Origin"/> and from the scores with no moment, so it can say why they are
/// absent rather than leave the reader to think them lost.
/// </para>
/// <para>
/// <b>Every record, not every act.</b> A finish logged on a run and a move to Finished are two
/// records and two items, each saying which it is. ADR 0047's precedence — a status change first,
/// per game and per kind — decides what the activity figures <em>count</em>, so that one act
/// recorded twice is one finish; a list of records counts nothing, and hiding a run's date behind
/// a move would hide something its owner wrote down.
/// </para>
/// <para>
/// Game titles and covers come from <see cref="IGameCacheService"/>, for the page's thirty games and
/// no others, so the history renders while IGDB is down like every other page about somebody's own
/// games (ADR 0035).
/// </para>
/// </remarks>
public class HistoryService(
    ApplicationDbContext db,
    IGameCacheService gameCache,
    IDataProtectionProvider dataProtection) : IHistoryService
{
    /// <summary>
    /// How many items one page carries. More than the reviews' ten or twenty, because an item is one
    /// line rather than a body of text.
    /// </summary>
    internal const int ItemsPerPage = 30;

    /// <summary>
    /// The time of day a playthrough's date sorts at among the instants: noon, UTC.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A date names a day, not a moment, so the order needs a convention, and it is only an order:
    /// the time never reaches the client, which shows the day as written. ADR 0047 §6 reads a date as
    /// midnight UTC to put it in a month, where the hour makes no difference. Here it does. A reader
    /// sees each instant on their own clock, and midnight UTC on the 17th is still the 16th anywhere
    /// west of Greenwich — so a run finished on the 17th would sit among their 16th's moves, the same
    /// slip `@/lib/stats` documents for <c>new Date('2026-05-01')</c>.
    /// </para>
    /// <para>
    /// Noon UTC falls inside the day it names for every offset from UTC−12 up to, but not including,
    /// UTC+12, which is nearly everybody. Only the far east of the Pacific, from UTC+12, reads it as
    /// the next morning.
    /// </para>
    /// </remarks>
    internal static readonly TimeOnly DatedItemTime = new(12, 0);

    /// <summary>Encrypts the cursors, which carry row ids the client must not see.</summary>
    private readonly IDataProtector cursors = dataProtection.CreateProtector(HistoryCursor.Purpose);

    public async Task<HistoryPageDto> GetHistoryAsync(
        string userId, string? after, CancellationToken cancellationToken = default)
    {
        HistoryPosition? from = null;
        if (after is not null)
        {
            if (!HistoryCursor.TryParse(cursors, after, out var position))
                throw new ArgumentException("Not a cursor this history issued.", nameof(after));
            from = position;
        }

        var rows = await Page(Items(db, userId), from).ToListAsync(cancellationToken);

        var page = rows.Take(ItemsPerPage).ToList();
        var next = rows.Count > ItemsPerPage
            ? HistoryCursor.Format(cursors, new HistoryPosition(page[^1].At, page[^1].Kind, page[^1].Id))
            : null;

        // The page's games only. Asked after the union rather than joined into it, because the
        // cache is where a stale copy is refreshed and a missing one fetched (ADR 0035) — a join on
        // the table would read it and nothing more.
        var games = page.Count == 0
            ? new Dictionary<int, GameDto>()
            : (await gameCache.GetGamesAsync(page.Select(r => r.GameId).Distinct(), cancellationToken))
                .ToDictionary(g => g.Id);

        // Both figures in one round trip, scoped like everything else here on the user's own id in
        // the predicate.
        var absent = await db.Users
            .AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => new
            {
                ImportedStatuses = db.UserGameEntries
                    .Count(e => e.UserId == u.Id && e.Origin != EntryOrigins.Manual),
                UndatedScores = db.UserGameEntries
                    .Count(e => e.UserId == u.Id && e.Score != null && e.ScoredAt == null)
            })
            .SingleOrDefaultAsync(cancellationToken);

        return new HistoryPageDto(
            page.Select(row => ToDto(row, games)).ToList(),
            next,
            absent?.ImportedStatuses ?? 0,
            absent?.UndatedScores ?? 0);
    }

    /// <summary>One item as the union reads it, before its game is looked up.</summary>
    /// <remarks>
    /// A class with settable members rather than a positional record, because EF matches the two
    /// sides of a set operation by member, and a member initialiser is the form it reads.
    /// </remarks>
    internal sealed class HistoryRow
    {
        /// <summary>
        /// The moment the item sorts at: the event's, the score's, or a playthrough's date at
        /// <see cref="DatedItemTime"/>.
        /// </summary>
        public DateTimeOffset At { get; init; }

        public int Kind { get; init; }

        /// <summary>The source row's own id, widened to the event log's <c>long</c>.</summary>
        public long Id { get; init; }

        public int GameId { get; init; }
        public string? FromStatus { get; init; }
        public string? ToStatus { get; init; }
        public short? Score { get; init; }
        public string? PlaythroughType { get; init; }
    }

    /// <summary>
    /// Every item in the user's history, in no order: one query, four branches.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Each branch is scoped on its own table's <c>UserId</c> — the authorization boundary, in the
    /// predicate where it can be read. A playthrough's game is reached through its entry, which the
    /// composite foreign key on <c>(UserGameEntryId, UserId)</c> makes the same user's (ADR 0025 §3).
    /// </para>
    /// <para>
    /// The statuses and the type travel as their permanent keys, joined in from the two lookups,
    /// so the page needs no second query to turn ids into keys and never sends an id.
    /// </para>
    /// <para>
    /// The <c>null</c>s are placeholders for what a branch does not have, and EF types them itself.
    /// PostgreSQL needs that: it types a union's columns a pair of branches at a time from the left,
    /// and reads a column that both of a pair leave null as <c>text</c>, which then fails to match a
    /// <c>smallint</c> further on. EF Core 10 with Npgsql writes the first branch's placeholder as
    /// <c>NULL::smallint</c> or <c>NULL::text</c> wherever that would happen, so the branches can be
    /// in any order — checked against PostgreSQL 18 in both orders that matter.
    /// </para>
    /// </remarks>
    internal static IQueryable<HistoryRow> Items(ApplicationDbContext db, string userId)
    {
        var moves = db.UserGameEvents
            .AsNoTracking()
            .Where(e => e.UserId == userId)
            .Select(e => new HistoryRow
            {
                At = e.OccurredAt,
                Kind = HistoryKinds.Status,
                Id = e.Id,
                GameId = e.GameId,
                FromStatus = e.FromStatus!.Key,
                ToStatus = e.ToStatus!.Key,
                Score = null,
                PlaythroughType = null
            });

        // Both conditions, though the check constraint makes the second imply the first: a score's
        // moment is shown only beside the score it belongs to.
        var scores = db.UserGameEntries
            .AsNoTracking()
            .Where(e => e.UserId == userId && e.Score != null && e.ScoredAt != null)
            .Select(e => new HistoryRow
            {
                At = e.ScoredAt!.Value,
                Kind = HistoryKinds.Score,
                Id = e.Id,
                GameId = e.GameId,
                FromStatus = null,
                ToStatus = null,
                Score = e.Score,
                PlaythroughType = null
            });

        // A start and a finish are two items when both are known: two things happened, on two days.
        //
        // The day becomes an instant in this exact form because it is the one both providers run
        // the same way. Npgsql writes `(date + time) AT TIME ZONE 'UTC'` and casts it to the
        // timestamptz the other branches carry; .NET marks the DateTime as UTC, which is what makes
        // the conversion keep the hour rather than take the machine's offset. A
        // `new DateTimeOffset(…)` reads the same and is not translated at all — it runs on the
        // client, and a union cannot follow a client projection.
        var starts = db.UserGamePlaythroughs
            .AsNoTracking()
            .Where(p => p.UserId == userId && p.StartedOn != null)
            .Select(p => new HistoryRow
            {
                At = (DateTimeOffset)DateTime.SpecifyKind(
                    p.StartedOn!.Value.ToDateTime(DatedItemTime), DateTimeKind.Utc),
                Kind = HistoryKinds.PlaythroughStarted,
                Id = p.Id,
                GameId = p.Entry.GameId,
                FromStatus = null,
                ToStatus = null,
                Score = null,
                PlaythroughType = p.Type!.Key
            });

        var finishes = db.UserGamePlaythroughs
            .AsNoTracking()
            .Where(p => p.UserId == userId && p.FinishedOn != null)
            .Select(p => new HistoryRow
            {
                At = (DateTimeOffset)DateTime.SpecifyKind(
                    p.FinishedOn!.Value.ToDateTime(DatedItemTime), DateTimeKind.Utc),
                Kind = HistoryKinds.PlaythroughFinished,
                Id = p.Id,
                GameId = p.Entry.GameId,
                FromStatus = null,
                ToStatus = null,
                Score = null,
                PlaythroughType = p.Type!.Key
            });

        return moves.Concat(scores).Concat(starts).Concat(finishes);
    }

    /// <summary>
    /// The page after <paramref name="from"/>, newest first, with one item more than a page to say
    /// whether there is another without counting the rest.
    /// </summary>
    /// <remarks>
    /// The cursor's comparison is the order written out — moment, then kind, then id, each
    /// descending — so "after" means exactly "the next in the order", ties included.
    /// </remarks>
    internal static IQueryable<HistoryRow> Page(IQueryable<HistoryRow> items, HistoryPosition? from)
    {
        if (from is { } position)
        {
            items = items.Where(r => r.At < position.At
                || (r.At == position.At
                    && (r.Kind < position.Kind || (r.Kind == position.Kind && r.Id < position.Id))));
        }

        return items
            .OrderByDescending(r => r.At)
            .ThenByDescending(r => r.Kind)
            .ThenByDescending(r => r.Id)
            .Take(ItemsPerPage + 1);
    }

    private static HistoryItemDto ToDto(HistoryRow row, IReadOnlyDictionary<int, GameDto> games)
    {
        var dated = HistoryKinds.IsDated(row.Kind);

        return new HistoryItemDto(
            Kind: HistoryKinds.Key(row.Kind),
            // A dated item's moment is only where it sorts. The day goes out as the day, and the
            // noon it was placed at goes nowhere.
            At: dated ? null : row.At,
            On: dated ? DateOnly.FromDateTime(row.At.UtcDateTime) : null,
            GameId: row.GameId,
            Game: games.TryGetValue(row.GameId, out var game)
                ? new GameRefDto(game.Id, game.Title, game.CoverImageUrl)
                : null,
            FromStatus: row.FromStatus,
            ToStatus: row.ToStatus,
            Score: row.Score,
            PlaythroughType: row.PlaythroughType);
    }
}
