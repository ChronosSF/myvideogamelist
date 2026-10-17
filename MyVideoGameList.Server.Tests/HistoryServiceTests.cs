using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The owner's history: three kinds of row unioned into one order, paged by a cursor, and nothing
/// shown that no row records.
/// </summary>
/// <remarks>
/// These run on the in-memory provider, which evaluates the union in .NET. What PostgreSQL makes of
/// the same query — the typed placeholders, the day placed at noon UTC, the cursor's comparison
/// pushed into every branch — was checked against the real database by hand, as ADR 0062 records;
/// nothing here could notice it translating differently.
/// </remarks>
public class HistoryServiceTests
{
    private const string UserId = "user-1";
    private const string OtherUserId = "user-2";

    private static readonly DateTimeOffset Now = new(2026, 10, 17, 9, 30, 0, TimeSpan.Zero);

    /// <summary>
    /// The real seeded statuses and playthrough types: <c>EnsureCreated</c> applies the context's own
    /// <c>HasData</c>, so the keys asserted here are the ones the migrations seed.
    /// </summary>
    private static ApplicationDbContext NewDb()
    {
        var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);
        db.Database.EnsureCreated();

        // The accounts, because the two counts are read through the account row.
        foreach (var id in new[] { UserId, OtherUserId })
            db.Users.Add(new ApplicationUser { Id = id, UserName = id, NormalizedUserName = id.ToUpperInvariant() });
        db.SaveChanges();

        return db;
    }

    private static GameDto Game(int id) =>
        new(id, $"Game {id}", null, null, $"https://images.example/{id}.jpg", null, null, null, null, null, null,
            null, null, Platforms: [], Genres: [], Developers: [], Publishers: [], Details: null);

    /// <summary>A cache that holds every game asked for, unless told which ones it does not.</summary>
    private static IGameCacheService Cache(params int[] missing)
    {
        var cache = Substitute.For<IGameCacheService>();
        cache.GetGamesAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>())
            .Returns(call => (IReadOnlyList<GameDto>)call.Arg<IEnumerable<int>>()
                .Where(id => !missing.Contains(id))
                .Select(Game)
                .ToList());
        return cache;
    }

    /// <summary>
    /// A service with a key ring of its own unless one is handed in. A cursor is encrypted, so the
    /// request that issues one and the request that reads it back must share a ring — as two
    /// requests to one deployment do — which is why the paging tests reuse one service.
    /// </summary>
    private static HistoryService NewService(
        ApplicationDbContext db, IGameCacheService? cache = null, IDataProtectionProvider? keys = null) =>
        new(db, cache ?? Cache(), keys ?? new EphemeralDataProtectionProvider());

    private static short StatusId(ApplicationDbContext db, string key) =>
        db.ListStatuses.Single(s => s.Key == key).Id;

    private static short TypeId(ApplicationDbContext db, string key) =>
        db.PlaythroughTypes.Single(t => t.Key == key).Id;

    private static void AddEvent(
        ApplicationDbContext db, int gameId, string? from, string? to, DateTimeOffset at, string userId = UserId)
    {
        db.UserGameEvents.Add(new UserGameEvent
        {
            UserId = userId,
            GameId = gameId,
            FromStatusId = from is null ? null : StatusId(db, from),
            ToStatusId = to is null ? null : StatusId(db, to),
            OccurredAt = at
        });
        db.SaveChanges();
    }

    /// <summary>The user's entry for a game, created as the arguments describe if it is not there.</summary>
    private static UserGameEntry Entry(
        ApplicationDbContext db,
        int gameId,
        string? status = null,
        short? score = null,
        DateTimeOffset? scoredAt = null,
        string origin = EntryOrigins.Manual,
        string userId = UserId)
    {
        var entry = db.UserGameEntries.FirstOrDefault(e => e.UserId == userId && e.GameId == gameId);
        if (entry is not null) return entry;

        entry = new UserGameEntry
        {
            UserId = userId,
            GameId = gameId,
            StatusId = status is null ? null : StatusId(db, status),
            Score = score,
            ScoredAt = scoredAt,
            Origin = origin,
            AddedAt = Now.AddYears(-1)
        };
        db.UserGameEntries.Add(entry);
        db.SaveChanges();
        return entry;
    }

    private static UserGamePlaythrough AddRun(
        ApplicationDbContext db,
        int gameId,
        DateOnly? startedOn = null,
        DateOnly? finishedOn = null,
        string? type = null,
        string userId = UserId)
    {
        var run = new UserGamePlaythrough
        {
            UserId = userId,
            Entry = Entry(db, gameId, userId: userId),
            TypeId = type is null ? null : TypeId(db, type),
            StartedOn = startedOn,
            FinishedOn = finishedOn,
            CreatedAt = Now,
            UpdatedAt = Now
        };
        db.UserGamePlaythroughs.Add(run);
        db.SaveChanges();
        return run;
    }

    /// <summary>Every page of the history, following each cursor to the end.</summary>
    private static async Task<List<HistoryPageDto>> ReadEveryPage(HistoryService service, string userId = UserId)
    {
        var pages = new List<HistoryPageDto>();
        string? after = null;

        // Bounded, so a cursor that failed to advance fails the test rather than hanging it.
        for (var i = 0; i < 20; i++)
        {
            var page = await service.GetHistoryAsync(userId, after);
            pages.Add(page);
            if (page.Next is null) return pages;
            after = page.Next;
        }

        throw new InvalidOperationException("The cursor never reached the end.");
    }

    /// <summary>One line per item, so a whole order can be asserted at once.</summary>
    private static string Describe(HistoryItemDto item) => item.Kind switch
    {
        "status" => $"status {item.GameId} {item.FromStatus ?? "-"}>{item.ToStatus ?? "-"}",
        "score" => $"score {item.GameId} {item.Score}",
        _ => $"{item.Kind} {item.GameId} {item.On:yyyy-MM-dd}"
    };

    // ── Each kind ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetHistoryAsync_StatusChange_IsAnItemNamingBothEndsByKey()
    {
        using var db = NewDb();
        AddEvent(db, 10, ListStatusKeys.Backlog, ListStatusKeys.Playing, Now.AddDays(-1));

        var item = Assert.Single((await NewService(db).GetHistoryAsync(UserId, after: null)).Items);

        Assert.Equal("status", item.Kind);
        Assert.Equal(Now.AddDays(-1), item.At);
        Assert.Null(item.On);
        Assert.Equal(10, item.GameId);
        Assert.Equal(ListStatusKeys.Backlog, item.FromStatus);
        Assert.Equal(ListStatusKeys.Playing, item.ToStatus);
        Assert.Null(item.Score);
        Assert.Null(item.PlaythroughType);
    }

    [Fact]
    public async Task GetHistoryAsync_FirstAddAndRemoval_LeaveTheMissingEndNull()
    {
        // Both are real transitions in the log (ADR 0018): into a list from none, and out of every
        // list. A null end is "no list", and the item says so rather than being dropped.
        using var db = NewDb();
        AddEvent(db, 10, from: null, ListStatusKeys.Backlog, Now.AddDays(-2));
        AddEvent(db, 10, ListStatusKeys.Backlog, to: null, Now.AddDays(-1));

        var items = (await NewService(db).GetHistoryAsync(UserId, after: null)).Items;

        Assert.Equal(["status 10 backlog>-", "status 10 ->backlog"], items.Select(Describe));
    }

    [Fact]
    public async Task GetHistoryAsync_Score_IsAnItemAtTheMomentItWasGiven()
    {
        using var db = NewDb();
        Entry(db, 10, score: 8, scoredAt: Now.AddHours(-3));

        var item = Assert.Single((await NewService(db).GetHistoryAsync(UserId, after: null)).Items);

        Assert.Equal("score", item.Kind);
        Assert.Equal(Now.AddHours(-3), item.At);
        Assert.Equal((short)8, item.Score);
        Assert.Null(item.FromStatus);
        Assert.Null(item.ToStatus);
    }

    [Fact]
    public async Task GetHistoryAsync_ScoreWithNoMoment_IsNoItemAndIsCounted()
    {
        // A score given before the column existed. Nothing recorded when, so nothing is shown — not
        // at the entry's AddedAt, which is when the game was first recorded rather than scored — and
        // the page is told how many such scores there are instead.
        using var db = NewDb();
        Entry(db, 10, score: 7, scoredAt: null);
        Entry(db, 11, score: 9, scoredAt: Now.AddDays(-1));

        var page = await NewService(db).GetHistoryAsync(UserId, after: null);

        Assert.Equal(["score 11 9"], page.Items.Select(Describe));
        Assert.Equal(1, page.UndatedScores);
    }

    [Fact]
    public async Task GetHistoryAsync_RunWithBothDates_IsTwoItemsLabelledByItsType()
    {
        using var db = NewDb();
        AddRun(db, 10, startedOn: new DateOnly(2026, 9, 1), finishedOn: new DateOnly(2026, 9, 20),
            type: PlaythroughTypeKeys.Completionist);

        var items = (await NewService(db).GetHistoryAsync(UserId, after: null)).Items;

        Assert.Equal(
            ["playthrough_finished 10 2026-09-20", "playthrough_started 10 2026-09-01"],
            items.Select(Describe));
        Assert.All(items, item => Assert.Equal(PlaythroughTypeKeys.Completionist, item.PlaythroughType));
    }

    [Fact]
    public async Task GetHistoryAsync_RunWithOneDate_IsOneItemAndAnUntypedRunHasNoLabel()
    {
        using var db = NewDb();
        AddRun(db, 10, finishedOn: new DateOnly(2026, 9, 20));
        AddRun(db, 11, startedOn: new DateOnly(2026, 9, 5), type: PlaythroughTypeKeys.Rushed);

        var items = (await NewService(db).GetHistoryAsync(UserId, after: null)).Items;

        Assert.Equal(
            ["playthrough_finished 10 2026-09-20", "playthrough_started 11 2026-09-05"],
            items.Select(Describe));
        Assert.Null(items[0].PlaythroughType);
        Assert.Equal(PlaythroughTypeKeys.Rushed, items[1].PlaythroughType);
    }

    [Fact]
    public async Task GetHistoryAsync_RunWithNoDates_IsNoItem()
    {
        // A run logged with hours and nothing else happened on no day this app knows of.
        using var db = NewDb();
        AddRun(db, 10, type: PlaythroughTypeKeys.Normally);

        var page = await NewService(db).GetHistoryAsync(UserId, after: null);

        Assert.Empty(page.Items);
    }

    [Fact]
    public async Task GetHistoryAsync_DatedItem_CarriesItsDayAndNoInstant()
    {
        // The noon it sorts at is the order's convention, not a time anybody recorded, so it is not
        // sent: the client shows the day as its owner wrote it.
        using var db = NewDb();
        AddRun(db, 10, finishedOn: new DateOnly(2026, 2, 28));

        var item = Assert.Single((await NewService(db).GetHistoryAsync(UserId, after: null)).Items);

        Assert.Null(item.At);
        Assert.Equal(new DateOnly(2026, 2, 28), item.On);
    }

    // ── One order ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetHistoryAsync_AllFourKinds_AreOneListNewestFirst()
    {
        using var db = NewDb();
        AddEvent(db, 10, ListStatusKeys.Backlog, ListStatusKeys.Playing, new DateTimeOffset(2026, 9, 1, 18, 0, 0, TimeSpan.Zero));
        AddRun(db, 10, startedOn: new DateOnly(2026, 9, 2), finishedOn: new DateOnly(2026, 9, 30));
        AddEvent(db, 10, ListStatusKeys.Playing, ListStatusKeys.Finished, new DateTimeOffset(2026, 10, 1, 8, 0, 0, TimeSpan.Zero));
        var scored = Entry(db, 10);
        scored.Score = 9;
        scored.ScoredAt = new DateTimeOffset(2026, 10, 2, 21, 15, 0, TimeSpan.Zero);
        db.SaveChanges();
        AddEvent(db, 20, from: null, ListStatusKeys.Backlog, new DateTimeOffset(2026, 9, 15, 7, 0, 0, TimeSpan.Zero));

        var items = (await NewService(db).GetHistoryAsync(UserId, after: null)).Items;

        Assert.Equal(
            [
                "score 10 9",
                "status 10 playing>finished",
                "playthrough_finished 10 2026-09-30",
                "status 20 ->backlog",
                "playthrough_started 10 2026-09-02",
                "status 10 backlog>playing"
            ],
            items.Select(Describe));
    }

    [Fact]
    public async Task GetHistoryAsync_DatedItem_SortsAtNoonUtcOnItsDay()
    {
        // The convention ADR 0062 settles: inside its own day for every reader from UTC−12 to just
        // short of UTC+12, so it is placed among that day's moves, between the morning's and the
        // evening's in UTC.
        using var db = NewDb();
        var day = new DateOnly(2026, 9, 20);
        AddEvent(db, 10, ListStatusKeys.Backlog, ListStatusKeys.Playing, new DateTimeOffset(2026, 9, 20, 11, 59, 0, TimeSpan.Zero));
        AddRun(db, 20, finishedOn: day);
        AddEvent(db, 30, ListStatusKeys.Backlog, ListStatusKeys.Playing, new DateTimeOffset(2026, 9, 20, 12, 1, 0, TimeSpan.Zero));

        var items = (await NewService(db).GetHistoryAsync(UserId, after: null)).Items;

        Assert.Equal([30, 20, 10], items.Select(i => i.GameId));
    }

    [Fact]
    public async Task GetHistoryAsync_RunStartedAndFinishedOnOneDay_ListsTheFinishFirst()
    {
        // One moment for both, so the kind decides, and newest first a finish reads above its start.
        using var db = NewDb();
        var day = new DateOnly(2026, 9, 20);
        AddRun(db, 10, startedOn: day, finishedOn: day, type: PlaythroughTypeKeys.Rushed);

        var items = (await NewService(db).GetHistoryAsync(UserId, after: null)).Items;

        Assert.Equal(["playthrough_finished 10 2026-09-20", "playthrough_started 10 2026-09-20"], items.Select(Describe));
    }

    [Fact]
    public async Task GetHistoryAsync_TiesWithinAKind_ListTheLaterRowFirst()
    {
        using var db = NewDb();
        var day = new DateOnly(2026, 9, 20);
        AddRun(db, 10, finishedOn: day);
        AddRun(db, 20, finishedOn: day);
        AddRun(db, 30, finishedOn: day);

        var items = (await NewService(db).GetHistoryAsync(UserId, after: null)).Items;

        Assert.Equal([30, 20, 10], items.Select(i => i.GameId));
    }

    [Fact]
    public async Task GetHistoryAsync_RunDateBesideAMoveToFinished_IsListedAsWell()
    {
        // ADR 0047's precedence decides what the activity figures count, so that one finish recorded
        // two ways is one finish. A list of records counts nothing: the run's date and the move are
        // two records, each item says which, and hiding the date would hide something its owner wrote.
        using var db = NewDb();
        AddRun(db, 10, finishedOn: new DateOnly(2026, 9, 30));
        AddEvent(db, 10, ListStatusKeys.Playing, ListStatusKeys.Finished, new DateTimeOffset(2026, 10, 2, 9, 0, 0, TimeSpan.Zero));

        var items = (await NewService(db).GetHistoryAsync(UserId, after: null)).Items;

        Assert.Equal(["status 10 playing>finished", "playthrough_finished 10 2026-09-30"], items.Select(Describe));
    }

    // ── Pages ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetHistoryAsync_EveryPage_ListsEveryItemOnceInOrder()
    {
        using var db = NewDb();
        var expected = new List<string>();

        // Seventy items of all four kinds, interleaved across seventy days.
        for (var i = 0; i < 70; i++)
        {
            var day = new DateOnly(2026, 8, 1).AddDays(i);
            var gameId = 100 + i;
            switch (i % 4)
            {
                case 0:
                    AddEvent(db, gameId, null, ListStatusKeys.Backlog, new DateTimeOffset(day.ToDateTime(new TimeOnly(18, 0)), TimeSpan.Zero));
                    break;
                case 1:
                    Entry(db, gameId, score: 6, scoredAt: new DateTimeOffset(day.ToDateTime(new TimeOnly(8, 0)), TimeSpan.Zero));
                    break;
                case 2:
                    AddRun(db, gameId, startedOn: day);
                    break;
                default:
                    AddRun(db, gameId, finishedOn: day);
                    break;
            }
            expected.Insert(0, gameId.ToString());
        }

        var pages = await ReadEveryPage(NewService(db));

        Assert.Equal([30, 30, 10], pages.Select(p => p.Items.Count));
        Assert.Equal(expected, pages.SelectMany(p => p.Items).Select(i => i.GameId.ToString()));
        Assert.Null(pages[^1].Next);
    }

    [Fact]
    public async Task GetHistoryAsync_ExactlyOnePage_HasNoCursor()
    {
        // One row is over-read to learn whether another page exists, so a history ending exactly on
        // a page boundary does not offer an empty page after it.
        using var db = NewDb();
        for (var i = 0; i < HistoryService.ItemsPerPage; i++)
            AddEvent(db, 100 + i, null, ListStatusKeys.Backlog, Now.AddMinutes(-i));

        var page = await NewService(db).GetHistoryAsync(UserId, after: null);

        Assert.Equal(HistoryService.ItemsPerPage, page.Items.Count);
        Assert.Null(page.Next);
    }

    [Fact]
    public async Task GetHistoryAsync_TieAcrossAPageBoundary_ListsEveryItemOnce()
    {
        // Thirty-five runs finished on one day share one moment and one kind, so the row id in the
        // cursor is all that carries the second page on from the right place.
        using var db = NewDb();
        for (var i = 0; i < 35; i++)
            AddRun(db, 100 + i, finishedOn: new DateOnly(2026, 9, 20));

        var pages = await ReadEveryPage(NewService(db));

        Assert.Equal([30, 5], pages.Select(p => p.Items.Count));
        Assert.Equal(
            Enumerable.Range(100, 35).Reverse(),
            pages.SelectMany(p => p.Items).Select(i => i.GameId));
    }

    [Fact]
    public async Task GetHistoryAsync_MoveMadeWhileReading_ShiftsNothingOnTheNextPage()
    {
        // The case an offset gets wrong. A game moved in another tab adds an item at the top, so
        // "offset 30" would repeat the first page's last item. The cursor names that item, and
        // everything after it is still everything after it.
        using var db = NewDb();
        for (var i = 0; i < 35; i++)
            AddEvent(db, 100 + i, null, ListStatusKeys.Backlog, Now.AddHours(-i));
        var service = NewService(db);

        var first = await service.GetHistoryAsync(UserId, after: null);
        AddEvent(db, 999, ListStatusKeys.Backlog, ListStatusKeys.Playing, Now.AddMinutes(1));
        var second = await service.GetHistoryAsync(UserId, first.Next);

        Assert.Equal(Enumerable.Range(130, 5), second.Items.Select(i => i.GameId));
        Assert.Empty(first.Items.Select(i => i.GameId).Intersect(second.Items.Select(i => i.GameId)));
    }

    [Fact]
    public async Task GetHistoryAsync_CursorItDidNotIssue_Throws()
    {
        // Garbage, a cursor protected under another key ring, and a review cursor from the same ring
        // under its own purpose. The controller turns each into a 400; reading one as "from the
        // start" would show the first page again as though it were the next.
        using var db = NewDb();
        for (var i = 0; i < 35; i++)
            AddEvent(db, 100 + i, null, ListStatusKeys.Backlog, Now.AddHours(-i));

        var keys = new EphemeralDataProtectionProvider();
        var foreign = (await NewService(db).GetHistoryAsync(UserId, after: null)).Next;
        var review = ReviewCursor.Format(keys.CreateProtector(ReviewCursor.Purpose), Now, 42);
        Assert.NotNull(foreign);

        var service = NewService(db, keys: keys);
        await Assert.ThrowsAsync<ArgumentException>(() => service.GetHistoryAsync(UserId, "not-a-cursor"));
        await Assert.ThrowsAsync<ArgumentException>(() => service.GetHistoryAsync(UserId, foreign));
        await Assert.ThrowsAsync<ArgumentException>(() => service.GetHistoryAsync(UserId, review));
    }

    [Fact]
    public async Task GetHistoryAsync_Cursor_CarriesNoRowIdTheClientCanRead()
    {
        // An event id counts every status change anybody has made, which is why no item carries one
        // and why the cursor that needs it is encrypted.
        using var db = NewDb();
        for (var i = 0; i < 35; i++)
            AddEvent(db, 100 + i, null, ListStatusKeys.Backlog, Now.AddHours(-i));
        var boundary = db.UserGameEvents.OrderByDescending(e => e.OccurredAt).Skip(HistoryService.ItemsPerPage - 1).First();

        var next = (await NewService(db).GetHistoryAsync(UserId, after: null)).Next;

        Assert.NotNull(next);
        Assert.Matches(HistoryCursor.Pattern, next);
        var plaintext = $"{boundary.OccurredAt.UtcTicks}.{HistoryKinds.Status}.{boundary.Id}";
        Assert.DoesNotContain(plaintext, Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(next)));
    }

    // ── What has no moment, and whose rows these are ──────────────────────────────────

    [Fact]
    public async Task GetHistoryAsync_ImportedStatus_IsNoItemAndIsCountedFromOrigin()
    {
        // An import writes a status and no event (ADR 0026 §2), and a score and no moment, so neither
        // has an item — and neither is placed at the import's own time, which would be fabricated
        // history. The run's dates are its owner's, written down in the other tracker, so those are
        // listed (ADR 0047). A move made here afterwards is an event like any other.
        using var db = NewDb();
        Entry(db, 10, ListStatusKeys.Finished, score: 8, scoredAt: null, origin: EntryOrigins.Grouvee);
        AddRun(db, 10, startedOn: new DateOnly(2024, 3, 1), finishedOn: new DateOnly(2024, 4, 2));
        Entry(db, 20, ListStatusKeys.Playing, origin: EntryOrigins.Grouvee);
        AddEvent(db, 20, ListStatusKeys.Playing, ListStatusKeys.Dropped, Now.AddDays(-1));

        var page = await NewService(db).GetHistoryAsync(UserId, after: null);

        Assert.Equal(
            ["status 20 playing>dropped", "playthrough_finished 10 2024-04-02", "playthrough_started 10 2024-03-01"],
            page.Items.Select(Describe));
        Assert.Equal(2, page.ImportedStatuses);
        Assert.Equal(1, page.UndatedScores);
    }

    [Fact]
    public async Task GetHistoryAsync_AnotherUsersRows_AreNeitherListedNorCounted()
    {
        using var db = NewDb();
        AddEvent(db, 10, null, ListStatusKeys.Backlog, Now, userId: OtherUserId);
        Entry(db, 10, score: 5, scoredAt: Now, userId: OtherUserId);
        Entry(db, 11, ListStatusKeys.Finished, score: 5, origin: EntryOrigins.Grouvee, userId: OtherUserId);
        AddRun(db, 10, startedOn: new DateOnly(2026, 9, 1), finishedOn: new DateOnly(2026, 9, 2), userId: OtherUserId);
        AddEvent(db, 30, null, ListStatusKeys.Playing, Now.AddDays(-1));

        var page = await NewService(db).GetHistoryAsync(UserId, after: null);

        Assert.Equal(["status 30 ->playing"], page.Items.Select(Describe));
        Assert.Equal(0, page.ImportedStatuses);
        Assert.Equal(0, page.UndatedScores);
    }

    [Fact]
    public async Task GetHistoryAsync_DeletedEntry_KeepsItsStatusChangesAndLosesTheRest()
    {
        // The log outlives the entry by design (ADR 0018); the score and the runs were the entry's,
        // and went with it.
        using var db = NewDb();
        AddEvent(db, 10, null, ListStatusKeys.Playing, Now.AddDays(-3));
        var entry = Entry(db, 10, ListStatusKeys.Playing, score: 6, scoredAt: Now.AddDays(-2));
        AddRun(db, 10, startedOn: new DateOnly(2026, 10, 14));
        AddEvent(db, 10, ListStatusKeys.Playing, null, Now.AddDays(-1));

        db.UserGamePlaythroughs.RemoveRange(db.UserGamePlaythroughs.Where(p => p.UserGameEntryId == entry.Id));
        db.UserGameEntries.Remove(entry);
        db.SaveChanges();

        var items = (await NewService(db).GetHistoryAsync(UserId, after: null)).Items;

        Assert.Equal(["status 10 playing>-", "status 10 ->playing"], items.Select(Describe));
    }

    // ── Games ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetHistoryAsync_Games_ComeFromTheCacheForThisPageOnly()
    {
        using var db = NewDb();
        for (var i = 0; i < 35; i++)
            AddEvent(db, 100 + (i % 33), null, ListStatusKeys.Backlog, Now.AddHours(-i));
        var cache = Cache();

        var page = await NewService(db, cache).GetHistoryAsync(UserId, after: null);

        // The thirty items name thirty distinct games here, and only those are asked for — once each.
        await cache.Received(1).GetGamesAsync(
            Arg.Is<IEnumerable<int>>(ids => ids.Order().SequenceEqual(page.Items.Select(i => i.GameId).Distinct().Order())),
            Arg.Any<CancellationToken>());
        Assert.All(page.Items, item =>
        {
            Assert.NotNull(item.Game);
            Assert.Equal(item.GameId, item.Game.Id);
            Assert.Equal($"Game {item.GameId}", item.Game.Name);
            Assert.Equal($"https://images.example/{item.GameId}.jpg", item.Game.CoverImageUrl);
        });
    }

    [Fact]
    public async Task GetHistoryAsync_GameTheCacheDoesNotHold_KeepsTheItemWithNoGame()
    {
        // A game IGDB no longer lists, or one never fetched while IGDB is down. The record is still
        // the user's, so it stays in the order, and the page can say it cannot name the game.
        using var db = NewDb();
        AddEvent(db, 10, null, ListStatusKeys.Backlog, Now.AddDays(-1));
        AddEvent(db, 20, null, ListStatusKeys.Backlog, Now.AddDays(-2));

        var items = (await NewService(db, Cache(missing: 10)).GetHistoryAsync(UserId, after: null)).Items;

        Assert.Equal([10, 20], items.Select(i => i.GameId));
        Assert.Null(items[0].Game);
        Assert.NotNull(items[1].Game);
    }

    [Fact]
    public async Task GetHistoryAsync_NothingRecorded_IsOneEmptyLastPageWithoutAskingForGames()
    {
        using var db = NewDb();
        var cache = Cache();

        var page = await NewService(db, cache).GetHistoryAsync(UserId, after: null);

        Assert.Empty(page.Items);
        Assert.Null(page.Next);
        await cache.DidNotReceive().GetGamesAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>());
    }
}
