using System.Runtime.CompilerServices;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using MyVideoGameList.Server.Services.Import;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The import end to end: upload, review, commit.
/// </summary>
/// <remarks>
/// The assertions that matter most here are the ones about what the import does <em>not</em> write.
/// An import creating a status without an event is the exemption ADR 0026 grants and ADR 0037
/// extends, and the event log is the one table in this schema no migration can reconstruct — so a
/// change that starts writing events, or that stamps <c>StatusChangedAt</c>, or that gives an
/// imported run a type, has to fail a test rather than be noticed in review.
/// </remarks>
public class ImportServiceTests
{
    private const string UserId = "user-1";
    private const string OtherUserId = "user-2";

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private static readonly DateTimeOffset Midday = new(2026, 3, 14, 12, 0, 0, TimeSpan.Zero);

    /// <summary>
    /// A context over its own store, or — given a <paramref name="name"/> — over one shared with
    /// another context, which is how the tests at the bottom of this file delete a job from under
    /// a service that is holding it.
    /// </summary>
    private static ApplicationDbContext NewDb(string? name = null)
    {
        var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(name ?? Guid.NewGuid().ToString())
                .Options);
        db.Database.EnsureCreated();
        return db;
    }

    /// <summary>
    /// The retention sweep, as far as these tests need it: the jobs and their rows are gone.
    /// </summary>
    /// <remarks>
    /// Through a second context, so the one under test still has the job tracked and modified —
    /// which is the state a request is in when the sweep runs, and the state that decides whether
    /// the write fails loudly or lands nowhere.
    /// </remarks>
    private static void Sweep(ApplicationDbContext sweeper)
    {
        sweeper.ImportRows.RemoveRange(sweeper.ImportRows.ToList());
        sweeper.ImportJobs.RemoveRange(sweeper.ImportJobs.ToList());
        sweeper.SaveChanges();
    }

    /// <summary>
    /// A clock that runs <paramref name="onFirstRead"/> before answering, once.
    /// </summary>
    /// <remarks>
    /// How a test gets inside the window between a service reading a job and saving its write to
    /// it. The retention sweep runs in that window for real, on its own schedule, knowing nothing
    /// about any request in flight.
    /// </remarks>
    private sealed class SweepingClock(DateTimeOffset now, Action onFirstRead) : TimeProvider
    {
        private bool swept;

        public override DateTimeOffset GetUtcNow()
        {
            if (!swept)
            {
                swept = true;
                onFirstRead();
            }

            return now;
        }
    }

    private static GameDto Game(int id, string title = "Game", params PlatformDto[] platforms) =>
        new(id, title, null, null, null, null, null, null, null, null, null, null, null,
            Platforms: platforms, Genres: [], Developers: [], Publishers: [], Details: null);

    private static IGameCacheService CacheReturning(params GameDto[] games)
    {
        var cache = Substitute.For<IGameCacheService>();
        cache.GetGamesAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>()).Returns(games);
        return cache;
    }

    /// <summary>
    /// A matcher that has looked at nothing, for the tests that are not about matching.
    /// </summary>
    /// <remarks>
    /// An empty dictionary is the right default rather than a lazy one: it means "no query was
    /// attempted", which is exactly what happens on every path but <c>MatchAsync</c>, and it leaves
    /// rows with a null candidate column as an upload does.
    /// </remarks>
    private static IImportMatcher NoMatcher()
    {
        var matcher = Substitute.For<IImportMatcher>();

        matcher
            .MatchAsync(Arg.Any<IReadOnlyCollection<ImportMatchQuery>>(), Arg.Any<CancellationToken>())
            .Returns(new Dictionary<ImportMatchQuery, ImportMatchResult>());

        return matcher;
    }

    /// <summary>A matcher whose answer for every query it is given is <paramref name="answer"/>.</summary>
    private static IImportMatcher MatcherAnswering(Func<ImportMatchQuery, ImportMatchResult?> answer)
    {
        var matcher = Substitute.For<IImportMatcher>();

        matcher
            .MatchAsync(Arg.Any<IReadOnlyCollection<ImportMatchQuery>>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                IReadOnlyDictionary<ImportMatchQuery, ImportMatchResult> answers = call
                    .Arg<IReadOnlyCollection<ImportMatchQuery>>()
                    .Distinct()
                    .Select(query => (Query: query, Result: answer(query)))
                    .Where(pair => pair.Result is not null)
                    .ToDictionary(pair => pair.Query, pair => pair.Result!);

                return Task.FromResult(answers);
            });

        return matcher;
    }

    private static ImportService NewService(
        ApplicationDbContext db, IGameCacheService? cache = null, IImportMatcher? matcher = null) =>
        new(db, cache ?? CacheReturning(), matcher ?? NoMatcher(), new FixedClock(Midday));

    /// <summary>A minimal Grouvee document, so each test states only what it is about.</summary>
    private static string Export(params string[] games) =>
        $$"""
          {
            "export_format_version": 2,
            "site": "https://www.grouvee.com",
            "account": { "favorite_games": [] },
            "collection": [{{string.Join(",", games)}}],
            "play_log": [], "reviews": []
          }
          """;

    /// <param name="igdbId">
    /// Written into the document verbatim, so a test can say <c>"null"</c> — the two-in-six-hundred
    /// case in the real export, and the whole of what a source without ids produces.
    /// </param>
    private static string Entry(
        string igdbId = "379",
        string name = "Metal Gear Solid 3",
        string shelves = """{"Played": {"date_added": "2021-10-02T06:54:47Z"}}""",
        string rating = "5",
        string dates = """[{"date_started": "None", "date_finished": "None", "seconds_played": 0, "level_of_completion": "Main Story", "platform": ""}]""",
        string review = "",
        string addedOn = "2021-10-02") =>
        $$"""
          {
            "id": 1, "name": "{{name}}", "shelves": {{shelves}},
            "platforms": {"PlayStation 2": {"url": ""} },
            "rating": {{rating}}, "review_title": "", "review": "{{review}}",
            "dates": {{dates}}, "release_date": "2004-11-17",
            "date_added_to_collection": "{{addedOn}}", "igdb_id": {{igdbId}}
          }
          """;

    private static async Task<Guid> UploadAsync(ImportService service, string document) =>
        (await service.CreateJobAsync(UserId, "grouvee_export.json", document)).Id;

    // ---------------------------------------------------------------- upload

    [Fact]
    public async Task CreateJobAsync_AGrouveeExport_StoresARowPerGameAndWritesNothingElse()
    {
        using var db = NewDb();
        var service = NewService(db);

        var job = await service.CreateJobAsync(UserId, "grouvee_export.json", Export(Entry()));

        Assert.Equal(ImportSources.Grouvee, job.Source);
        Assert.Equal(ImportJobStates.Pending, job.State);
        Assert.Equal(1, job.RowCount);

        // The upload reviews; it does not import.
        Assert.Empty(db.UserGameEntries);
        Assert.Empty(db.UserGameEvents);
    }

    [Fact]
    public async Task CreateJobAsync_AMatchedRow_IsPreCheckedAndARowWithNoIdIsNot()
    {
        using var db = NewDb();
        var service = NewService(db);

        var jobId = await UploadAsync(service, Export(Entry(), Entry(name: "No Id", igdbId: "null")));
        var review = await service.GetReviewAsync(UserId, jobId);

        var matched = Assert.Single(review!.Rows, r => r.MatchKind == ImportMatchKinds.Matched);

        // `unlooked` rather than `unmatched`, and that is not a detail: `unmatched` means a pass
        // looked and found nothing, so a row born with it would be out of reach of every matching
        // pass for ever.
        var unresolved = Assert.Single(review.Rows, r => r.MatchKind == ImportMatchKinds.Unlooked);

        Assert.Equal(ImportDecisions.Import, matched.Decision);
        Assert.Equal(ImportDecisions.Skip, unresolved.Decision);
    }

    [Fact]
    public async Task CreateJobAsync_AGameTheUserAlreadyTracks_DefaultsToSkip()
    {
        // §S8: an import must not overwrite what somebody recorded by hand unless they say so per
        // row. Defaulting it to skip is how "unless they say so" is enforced.
        using var db = NewDb();
        db.UserGameEntries.Add(new UserGameEntry { UserId = UserId, GameId = 379, AddedAt = Midday });
        await db.SaveChangesAsync();

        var service = NewService(db, CacheReturning(Game(379)));
        var jobId = await UploadAsync(service, Export(Entry()));

        var row = Assert.Single((await service.GetReviewAsync(UserId, jobId))!.Rows);
        Assert.True(row.AlreadyTracked);
        Assert.Equal(ImportDecisions.Skip, row.Decision);
    }

    [Fact]
    public async Task CreateJobAsync_AFileNoPresetRecognises_IsRefused()
    {
        using var db = NewDb();
        var service = NewService(db);

        await Assert.ThrowsAsync<ImportRejectedException>(
            () => service.CreateJobAsync(UserId, "games.csv", "title,platform,status\nHalo,Xbox,done"));

        Assert.Empty(db.ImportJobs);
    }

    [Fact]
    public async Task CreateJobAsync_AnEmptyFile_IsRefused()
    {
        using var db = NewDb();

        await Assert.ThrowsAsync<ImportRejectedException>(
            () => NewService(db).CreateJobAsync(UserId, "grouvee_export.json", "   "));
    }

    [Fact]
    public async Task CreateJobAsync_AnExportWithNoGames_IsRefused()
    {
        using var db = NewDb();

        await Assert.ThrowsAsync<ImportRejectedException>(
            () => NewService(db).CreateJobAsync(UserId, "grouvee_export.json", Export()));
    }

    [Fact]
    public async Task CreateJobAsync_PastTheLimitOfPendingJobs_IsRefused()
    {
        using var db = NewDb();
        var service = NewService(db);

        for (var i = 0; i < ImportService.MaxPendingJobs; i++)
            await UploadAsync(service, Export(Entry()));

        var error = await Assert.ThrowsAsync<ImportRejectedException>(
            () => service.CreateJobAsync(UserId, "grouvee_export.json", Export(Entry())));

        Assert.Contains("waiting to be reviewed", error.Message);
    }

    [Theory]
    [InlineData(@"C:\Users\someone\grouvee_export.json")]
    [InlineData("/home/someone/grouvee_export.json")]
    [InlineData(@"..\..\grouvee_export.json")]
    [InlineData("grouvee_export.json")]
    public async Task CreateJobAsync_AFileNameWithAPath_KeepsOnlyTheName(string sent)
    {
        // Both separators, on every platform. `Path.GetFileName` follows the *host's* rules,
        // so on Linux — where this is deployed — it treats a backslash as an ordinary filename
        // character and keeps a Windows path whole. The name comes from whichever machine the
        // browser is on, so the separator set belongs to the input rather than to the server.
        // CI on Linux caught this; the Windows-only run before it could not.
        using var db = NewDb();

        var job = await NewService(db).CreateJobAsync(UserId, sent, Export(Entry()));

        Assert.Equal("grouvee_export.json", job.FileName);
    }

    [Fact]
    public async Task CreateJobAsync_AFileNameThatIsNothingButAPath_FallsBackRatherThanStoringBlank()
    {
        using var db = NewDb();

        var job = await NewService(db).CreateJobAsync(UserId, "/home/someone/", Export(Entry()));

        Assert.Equal("import", job.FileName);
    }

    // ---------------------------------------------------------------- committing

    [Fact]
    public async Task CommitAsync_WritesTheStatusAndNoEvent()
    {
        // The whole of ADR 0026 decision 2, and the reason this service exists separately. An
        // event would carry the import's own timestamp and be permanent fabricated history.
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));

        var jobId = await UploadAsync(service, Export(Entry(
            dates: """[{"date_started": "None", "date_finished": "2022-09-23", "seconds_played": 0, "level_of_completion": "Main Story", "platform": ""}]""")));

        var result = await service.CommitAsync(UserId, jobId);

        Assert.Equal(1, result!.Job.ImportedCount);

        var entry = Assert.Single(db.UserGameEntries);
        Assert.Equal(db.ListStatuses.Single(s => s.Key == ListStatusKeys.Finished).Id, entry.StatusId);
        Assert.Empty(db.UserGameEvents);
    }

    [Fact]
    public async Task CommitAsync_LeavesStatusChangedAtNull()
    {
        // The sort key behind "recently moved". Stamping it would put an entire imported library
        // at the top of that order and bury everything the user actually touched (ADR 0026 §5).
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));

        var jobId = await UploadAsync(service, Export(Entry(
            shelves: """{"Playing": {"date_added": "2025-11-28T00:00:00Z"}}""")));
        await service.CommitAsync(UserId, jobId);

        Assert.Null(Assert.Single(db.UserGameEntries).StatusChangedAt);
    }

    [Fact]
    public async Task CommitAsync_MarksTheEntryWithTheSourceAsItsOrigin()
    {
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));

        var jobId = await UploadAsync(service, Export(Entry(
            shelves: """{"Backlog": {"date_added": "2025-11-28T00:00:00Z"}}""")));
        await service.CommitAsync(UserId, jobId);

        Assert.Equal(EntryOrigins.Grouvee, Assert.Single(db.UserGameEntries).Origin);
    }

    [Fact]
    public async Task CommitAsync_TakesAddedAtFromTheSource()
    {
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));

        var jobId = await UploadAsync(service, Export(Entry(addedOn: "2021-10-02")));
        await service.CommitAsync(UserId, jobId);

        Assert.Equal(
            new DateTimeOffset(2021, 10, 2, 0, 0, 0, TimeSpan.Zero),
            Assert.Single(db.UserGameEntries).AddedAt);
    }

    [Fact]
    public async Task CommitAsync_APlayedGameWithNoFinishDate_GetsNoStatusAndStaysManual()
    {
        // ADR 0026's ambiguous bucket. The entry is real — the user has data about this game — but
        // no status is invented for it, so nothing eventless was written and the origin is untouched.
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));

        var jobId = await UploadAsync(service, Export(Entry()));
        await service.CommitAsync(UserId, jobId);

        var entry = Assert.Single(db.UserGameEntries);
        Assert.Null(entry.StatusId);
        Assert.Equal(EntryOrigins.Manual, entry.Origin);
        Assert.Empty(db.UserGameEvents);
    }

    [Fact]
    public async Task CommitAsync_APlaythrough_CarriesItsMinutesAndNoType()
    {
        // ADR 0037 decision 4. A typed run with a duration feeds the community medians, and the
        // source's completion level is a default rather than its owner's answer.
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));

        var jobId = await UploadAsync(service, Export(Entry(
            dates: """[{"date_started": "2024-04-25", "date_finished": "2024-04-28", "seconds_played": 22500, "level_of_completion": "Completionist", "platform": ""}]""")));
        await service.CommitAsync(UserId, jobId);

        var run = Assert.Single(db.UserGamePlaythroughs);
        Assert.Null(run.TypeId);
        Assert.Equal(375, run.MinutesPlayed);
        Assert.Equal(new DateOnly(2024, 4, 25), run.StartedOn);
    }

    [Fact]
    public async Task CommitAsync_ResolvesThePlatformAgainstTheGamesOwnPlatforms()
    {
        // No network call, and the candidate set is the platforms the game is on, so there is
        // nothing to be ambiguous about.
        using var db = NewDb();
        var cache = CacheReturning(Game(379, platforms: new PlatformDto(8, "PlayStation 2", "PS2", null, null)));
        var service = NewService(db, cache);

        var jobId = await UploadAsync(service, Export(Entry(
            dates: """[{"date_started": "2024-04-25", "date_finished": "None", "seconds_played": 3600, "level_of_completion": "Main Story", "platform": "PlayStation 2"}]""")));
        await service.CommitAsync(UserId, jobId);

        Assert.Equal(8, Assert.Single(db.UserGamePlaythroughs).PlatformId);
    }

    [Fact]
    public async Task CommitAsync_APlatformNameThatDoesNotResolve_LeavesThePlatformNullRatherThanFailing()
    {
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));

        var jobId = await UploadAsync(service, Export(Entry(
            dates: """[{"date_started": "2024-04-25", "date_finished": "None", "seconds_played": 3600, "level_of_completion": "Main Story", "platform": "A Console We Cannot Place"}]""")));
        await service.CommitAsync(UserId, jobId);

        var run = Assert.Single(db.UserGamePlaythroughs);
        Assert.Null(run.PlatformId);
        Assert.Equal(60, run.MinutesPlayed);
    }

    [Fact]
    public async Task CommitAsync_TheScoreFromTheSource_LandsOnTheEntry()
    {
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));

        var jobId = await UploadAsync(service, Export(Entry(rating: "4")));
        await service.CommitAsync(UserId, jobId);

        Assert.Equal((short)8, Assert.Single(db.UserGameEntries).Score);
    }

    [Fact]
    public async Task CommitAsync_DoesNotOverwriteAScoreTheUserAlreadySet()
    {
        // An import is new information about a game, not a correction of what its owner recorded.
        using var db = NewDb();
        db.UserGameEntries.Add(new UserGameEntry
        {
            UserId = UserId, GameId = 379, Score = 3, Notes = "Mine.", AddedAt = Midday
        });
        await db.SaveChangesAsync();

        var service = NewService(db, CacheReturning(Game(379)));
        var jobId = await UploadAsync(service, Export(Entry(rating: "5", review: "Theirs.")));

        // The row defaults to skip because the game is already tracked, so the user has to opt in.
        var row = Assert.Single((await service.GetReviewAsync(UserId, jobId))!.Rows);
        await service.SetDecisionsAsync(UserId, jobId, new ImportDecisionsDto(
            [new ImportRowDecisionDto(row.Id, ImportDecisions.Import, null, null)]));

        await service.CommitAsync(UserId, jobId);

        var entry = Assert.Single(db.UserGameEntries);
        Assert.Equal((short)3, entry.Score);
        Assert.Equal("Mine.", entry.Notes);
    }

    [Fact]
    public async Task CommitAsync_TheSameFileTwice_DoesNotDuplicateThePlaythrough()
    {
        // §M7. Re-importing is something people do when the first pass went wrong, and stacking a
        // second copy of every run would make that worse rather than harmless.
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));
        var document = Export(Entry(
            dates: """[{"date_started": "2024-04-25", "date_finished": "2024-04-28", "seconds_played": 22500, "level_of_completion": "Main Story", "platform": ""}]"""));

        await service.CommitAsync(UserId, await UploadAsync(service, document));

        var secondJob = await UploadAsync(service, document);
        var row = Assert.Single((await service.GetReviewAsync(UserId, secondJob))!.Rows);
        await service.SetDecisionsAsync(UserId, secondJob, new ImportDecisionsDto(
            [new ImportRowDecisionDto(row.Id, ImportDecisions.Import, null, null)]));
        await service.CommitAsync(UserId, secondJob);

        Assert.Single(db.UserGamePlaythroughs);
    }

    [Fact]
    public async Task CommitAsync_AWishListShelf_WritesToTheWishlistAxisAndNoStatus()
    {
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));

        var jobId = await UploadAsync(service, Export(Entry(
            shelves: """{"Wish List": {"date_added": "2025-11-28T00:00:00Z"}}""")));
        await service.CommitAsync(UserId, jobId);

        var wanted = Assert.Single(db.UserWishlistItems);
        Assert.Equal(379, wanted.GameId);
        Assert.Null(Assert.Single(db.UserGameEntries).StatusId);

        // The axis orders by this and nothing else, so it takes the source's date for the reason
        // the entry does — otherwise an imported wishlist lands on top of everything the user
        // wanted recently.
        Assert.Equal(new DateTimeOffset(2021, 10, 2, 0, 0, 0, TimeSpan.Zero), wanted.AddedAt);
    }

    [Fact]
    public async Task CommitAsync_ARowTheUserSkipped_IsReportedWithItsReason()
    {
        // §C5: nothing is silently lost. The reason is what the failure report is built from.
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));

        var jobId = await UploadAsync(service, Export(Entry()));
        var row = Assert.Single((await service.GetReviewAsync(UserId, jobId))!.Rows);
        await service.SetDecisionsAsync(UserId, jobId, new ImportDecisionsDto(
            [new ImportRowDecisionDto(row.Id, ImportDecisions.Skip, null, null)]));

        var result = await service.CommitAsync(UserId, jobId);

        Assert.Equal(0, result!.Job.ImportedCount);
        Assert.Equal(1, result.Job.SkippedCount);
        Assert.Equal("Metal Gear Solid 3", Assert.Single(result.Skipped).Title);
        Assert.Empty(db.UserGameEntries);
    }

    [Fact]
    public async Task CommitAsync_ANoteLongerThanTheColumn_IsCutRatherThanFailingTheWholeImport()
    {
        // A Grouvee review can run past 2,000 characters. Left alone it would abort the final save
        // and lose every other game in the file.
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));

        var jobId = await UploadAsync(service, Export(Entry(review: new string('a', 2500))));
        await service.CommitAsync(UserId, jobId);

        Assert.Equal(2000, Assert.Single(db.UserGameEntries).Notes!.Length);
    }

    [Fact]
    public async Task CreateJobAsync_TheSourcesOwnRowId_IsStoredOnTheRow()
    {
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));

        await UploadAsync(service, Export(Entry()));

        Assert.Equal("1", db.ImportRows.Single().SourceRef);
    }

    [Fact]
    public async Task CommitAsync_AsksTheGameCacheBeforeItCreatesAnyEntry()
    {
        // The ordering is load-bearing and nothing else would catch a reorder. IGameCacheService
        // shares this DbContext and calls SaveChangesAsync when it refreshes a game from IGDB, so
        // asking it after the entries exist commits them early — status-less, origin `manual`,
        // carrying the wrong AddedAt — and a later failure leaves that half-built import behind.
        //
        // Asserted by looking at the change tracker at the moment the cache is called, because the
        // substitute that every other test here uses is exactly what hides the real behaviour.
        using var db = NewDb();
        var service = NewService(db, CacheThatChecks(db, out var pendingEntriesWhenCalled));

        var jobId = await UploadAsync(service, Export(Entry()));
        await service.CommitAsync(UserId, jobId);

        Assert.Equal(0, pendingEntriesWhenCalled.Value);
    }

    /// <summary>
    /// A cache that records how many entries were waiting to be written when it was asked.
    /// </summary>
    private static IGameCacheService CacheThatChecks(ApplicationDbContext db, out StrongBox<int> pending)
    {
        var seen = new StrongBox<int>(-1);
        pending = seen;

        var cache = Substitute.For<IGameCacheService>();
        cache.GetGamesAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                // Only the commit's own call matters; the review reads through here too.
                var added = db.ChangeTracker.Entries<UserGameEntry>()
                    .Count(entry => entry.State == EntityState.Added);

                seen.Value = Math.Max(seen.Value, added);
                return Task.FromResult<IReadOnlyList<GameDto>>([Game(379)]);
            });

        return cache;
    }

    [Fact]
    public async Task CommitAsync_ClosesTheJobSoItCannotBeCommittedTwice()
    {
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));

        var jobId = await UploadAsync(service, Export(Entry()));
        var first = await service.CommitAsync(UserId, jobId);

        Assert.Equal(ImportJobStates.Done, first!.Job.State);
        Assert.Null(await service.CommitAsync(UserId, jobId));
        Assert.Single(db.UserGameEntries);
    }

    // ---------------------------------------------------------------- decisions

    [Fact]
    public async Task SetDecisionsAsync_ResolvingAnUnrecognisedShelf_GivesTheRowThatStatus()
    {
        // §3.2: an unrecognised status is never silently defaulted; the user resolves it.
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));

        var jobId = await UploadAsync(service, Export(Entry(
            shelves: """{"Gave Up On": {"date_added": "2025-11-28T00:00:00Z"}}""")));

        var row = Assert.Single((await service.GetReviewAsync(UserId, jobId))!.Rows);
        Assert.True(row.StatusUnrecognised);

        await service.SetDecisionsAsync(UserId, jobId, new ImportDecisionsDto(
            [new ImportRowDecisionDto(row.Id, ImportDecisions.Import, null, ListStatusKeys.Dropped)]));
        await service.CommitAsync(UserId, jobId);

        Assert.Equal(
            db.ListStatuses.Single(s => s.Key == ListStatusKeys.Dropped).Id,
            Assert.Single(db.UserGameEntries).StatusId);
    }

    [Fact]
    public async Task SetDecisionsAsync_AnUnknownStatusKey_IsIgnoredRatherThanStored()
    {
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));

        var jobId = await UploadAsync(service, Export(Entry()));
        var row = Assert.Single((await service.GetReviewAsync(UserId, jobId))!.Rows);

        await service.SetDecisionsAsync(UserId, jobId, new ImportDecisionsDto(
            [new ImportRowDecisionDto(row.Id, ImportDecisions.Import, null, "not-a-status")]));

        Assert.Null(Assert.Single((await service.GetReviewAsync(UserId, jobId))!.Rows).Status);
    }

    [Fact]
    public async Task SetDecisionsAsync_PickingAGameForAnUnmatchedRow_MakesItImportable()
    {
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(42)));

        var jobId = await UploadAsync(service, Export(
            Entry(name: "Unknown Game", igdbId: "null")));

        var row = Assert.Single((await service.GetReviewAsync(UserId, jobId))!.Rows);
        await service.SetDecisionsAsync(UserId, jobId, new ImportDecisionsDto(
            [new ImportRowDecisionDto(row.Id, ImportDecisions.Import, 42, null)]));

        await service.CommitAsync(UserId, jobId);

        Assert.Equal(42, Assert.Single(db.UserGameEntries).GameId);
    }

    // ---------------------------------------------------------------- matching

    /// <summary>An export of games the file names but does not identify — what matching is for.</summary>
    private static string Unidentified(params string[] names) =>
        Export([.. names.Select(name => Entry(name: name, igdbId: "null"))]);

    [Fact]
    public async Task MatchAsync_ARowTheMatcherResolved_IsMatchedAndPreChecked()
    {
        // A resolved row earns exactly what an id in the file earns (§M3): the game, and the tick
        // beside it. Anything less would mean a preset without ids arrives with every row unchecked
        // and a person clicking six hundred times.
        using var db = NewDb();
        var service = NewService(
            db,
            CacheReturning(Game(42)),
            MatcherAnswering(_ => new ImportMatchResult(ImportMatchKinds.Matched, 42, [])));

        var jobId = await UploadAsync(service, Unidentified("Unknown Game"));
        var row = Assert.Single((await service.MatchAsync(UserId, jobId))!.Examined);

        Assert.Equal(ImportMatchKinds.Matched, row.MatchKind);
        Assert.Equal(42, row.GameId);
        Assert.Equal(ImportDecisions.Import, row.Decision);
        Assert.Equal(0, (await service.GetReviewAsync(UserId, jobId))!.Summary.Unlooked);
    }

    [Fact]
    public async Task MatchAsync_AnswersWithTheRowsItExamined_AndNoOthers()
    {
        // The contract the client loops on, and the reason it is not the whole review: a pass
        // resolves a bounded batch, so answering with every row would re-read and re-send the
        // entire job on each of the hundred passes a large id-less import takes.
        using var db = NewDb();
        var service = NewService(
            db,
            CacheReturning(Game(42), Game(379)),
            MatcherAnswering(_ => new ImportMatchResult(ImportMatchKinds.Matched, 42, [])));

        var jobId = await UploadAsync(service, Export(
            Entry(name: "Has An Id"),
            Entry(name: "Has None", igdbId: "null")));

        var examined = Assert.Single((await service.MatchAsync(UserId, jobId))!.Examined);

        Assert.Equal("Has None", examined.Title);
        Assert.Equal(2, (await service.GetReviewAsync(UserId, jobId))!.Rows.Count);
    }

    [Fact]
    public async Task MatchAsync_AnAmbiguousRow_OffersItsCandidatesAndStaysOnSkip()
    {
        // The whole point of the middle tier. The row carries everything needed to choose and
        // chooses nothing, so a review committed without reading it imports no guess.
        using var db = NewDb();
        var service = NewService(
            db,
            CacheReturning(Game(7, "Silent Hill"), Game(8, "Silent Hill")),
            MatcherAnswering(_ => new ImportMatchResult(ImportMatchKinds.Ambiguous, null, [7, 8])));

        var jobId = await UploadAsync(service, Unidentified("Silent Hill"));
        var row = Assert.Single((await service.MatchAsync(UserId, jobId))!.Examined);

        Assert.Equal(ImportMatchKinds.Ambiguous, row.MatchKind);
        Assert.Null(row.GameId);
        Assert.Equal(ImportDecisions.Skip, row.Decision);
        Assert.Equal([7, 8], row.Candidates.Select(game => game.Id));
        Assert.Equal(1, (await service.GetReviewAsync(UserId, jobId))!.Summary.Ambiguous);
    }

    [Fact]
    public async Task MatchAsync_ARowTheMatcherResolvedToAGameAlreadyTracked_StillDefaultsToSkip()
    {
        // §S8 does not stop applying because the game was found rather than named. Importing this
        // row overwrites what its owner recorded by hand, so it stays their decision.
        using var db = NewDb();
        db.UserGameEntries.Add(new UserGameEntry { UserId = UserId, GameId = 42, AddedAt = Midday });
        await db.SaveChangesAsync();

        var service = NewService(
            db,
            CacheReturning(Game(42)),
            MatcherAnswering(_ => new ImportMatchResult(ImportMatchKinds.Matched, 42, [])));

        var jobId = await UploadAsync(service, Unidentified("Unknown Game"));
        var row = Assert.Single((await service.MatchAsync(UserId, jobId))!.Examined);

        Assert.Equal(42, row.GameId);
        Assert.True(row.AlreadyTracked);
        Assert.Equal(ImportDecisions.Skip, row.Decision);
    }

    [Fact]
    public async Task MatchAsync_ARowNothingWasFoundFor_IsNotAskedAboutAgain()
    {
        // What makes repeating a pass walk an import forwards instead of grinding on its hardest
        // rows. The matcher answered, and the answer was "nothing" — asking IGDB the identical
        // question again would spend the next pass's whole budget re-failing.
        using var db = NewDb();
        var matcher = MatcherAnswering(_ => new ImportMatchResult(ImportMatchKinds.Unmatched, null, []));
        var service = NewService(db, matcher: matcher);

        var jobId = await UploadAsync(service, Unidentified("Nothing Like This Exists"));

        await service.MatchAsync(UserId, jobId);
        var second = await service.MatchAsync(UserId, jobId);

        await matcher.Received(1).MatchAsync(
            Arg.Any<IReadOnlyCollection<ImportMatchQuery>>(), Arg.Any<CancellationToken>());

        // Nothing left to examine, which is the answer the client stops on.
        Assert.Empty(second!.Examined);
        Assert.Equal(1, (await service.GetReviewAsync(UserId, jobId))!.Summary.Unmatched);
    }

    [Fact]
    public async Task MatchAsync_ARowThePassRanOutOfBudgetFor_IsTheNextPassesWork()
    {
        // The other half of the same rule, and the reason an unanswered query must not be written
        // down as "unmatched": a row the matcher never reached has to stay indistinguishable from a
        // freshly uploaded one, or a large import would give up on itself after one pass.
        using var db = NewDb();
        var matcher = MatcherAnswering(query => query.Title == "Reached"
            ? new ImportMatchResult(ImportMatchKinds.Matched, 42, [])
            : null);

        var service = NewService(db, CacheReturning(Game(42)), matcher);

        var jobId = await UploadAsync(service, Unidentified("Reached", "Never Got To"));

        Assert.Equal("Reached", Assert.Single((await service.MatchAsync(UserId, jobId))!.Examined).Title);
        Assert.Equal(1, (await service.GetReviewAsync(UserId, jobId))!.Summary.Unlooked);

        await service.MatchAsync(UserId, jobId);

        await matcher.Received(2).MatchAsync(
            Arg.Any<IReadOnlyCollection<ImportMatchQuery>>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task MatchAsync_ARowTheFileAlreadyIdentified_IsNeverLookedUp()
    {
        // ADR 0037's decision 2, still true now that the matcher exists: an id in the file needs no
        // matching, so a Grouvee import of six hundred games asks IGDB about the two it could not
        // name and not about the rest.
        using var db = NewDb();
        var matcher = MatcherAnswering(_ => new ImportMatchResult(ImportMatchKinds.Unmatched, null, []));
        var service = NewService(db, CacheReturning(Game(379)), matcher);

        var jobId = await UploadAsync(service, Export(
            Entry(name: "Has An Id"),
            Entry(name: "Has None", igdbId: "null")));

        await service.MatchAsync(UserId, jobId);

        await matcher.Received(1).MatchAsync(
            Arg.Is<IReadOnlyCollection<ImportMatchQuery>>(
                queries => queries.Count == 1 && queries.Single().Title == "Has None"),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task MatchAsync_NothingLeftToLookAt_AsksTheMatcherNothing()
    {
        using var db = NewDb();
        var matcher = NoMatcher();
        var service = NewService(db, CacheReturning(Game(379)), matcher);

        var jobId = await UploadAsync(service, Export(Entry()));

        Assert.Empty((await service.MatchAsync(UserId, jobId))!.Examined);
        await matcher.DidNotReceive().MatchAsync(
            Arg.Any<IReadOnlyCollection<ImportMatchQuery>>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task MatchAsync_MovesTheJobsClock()
    {
        // Matching is somebody working on their review, so it counts as the sign of life the
        // pending window measures — a person feeding a five-thousand-row import through pass after
        // pass must not have it deleted underneath them for never saving a decision.
        using var db = NewDb();
        var jobId = await UploadAsync(NewService(db), Unidentified("Unknown Game"));

        var later = Midday.AddDays(9);
        await new ImportService(
                db,
                CacheReturning(Game(42)),
                MatcherAnswering(_ => new ImportMatchResult(ImportMatchKinds.Matched, 42, [])),
                new FixedClock(later))
            .MatchAsync(UserId, jobId);

        Assert.Equal(later, (await db.ImportJobs.SingleAsync()).UpdatedAt);
    }

    [Fact]
    public async Task MatchAsync_AJobThatIsAlreadyOver_IsNotFound()
    {
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));

        var jobId = await UploadAsync(service, Export(Entry()));
        await service.CommitAsync(UserId, jobId);

        Assert.Null(await service.MatchAsync(UserId, jobId));
    }

    [Fact]
    public async Task MatchAsync_AJobBelongingToSomebodyElse_IsNotFound()
    {
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));

        var jobId = await UploadAsync(service, Export(Entry()));

        Assert.Null(await service.MatchAsync(OtherUserId, jobId));
    }

    [Fact]
    public async Task MatchAsync_WhenTheJobIsSweptMidRequest_IsNotFoundRatherThanAnError()
    {
        // The same window the other three writes have, and the widest of them: a pass spends
        // seconds inside IGDB's rate limiter between reading the job and saving what it found.
        var name = Guid.NewGuid().ToString();
        using var db = NewDb(name);
        using var sweeper = NewDb(name);

        var jobId = await UploadAsync(NewService(db), Unidentified("Unknown Game"));

        var service = new ImportService(
            db,
            CacheReturning(Game(42)),
            MatcherAnswering(_ => new ImportMatchResult(ImportMatchKinds.Matched, 42, [])),
            new SweepingClock(Midday, () => Sweep(sweeper)));

        Assert.Null(await service.MatchAsync(UserId, jobId));
    }

    [Fact]
    public async Task SetDecisionsAsync_ChoosingOneCandidate_LeavesTheOthersBehind()
    {
        // A resolved row must stop offering alternatives, or the screen goes on inviting somebody
        // to pick again from a list that no longer includes what they picked.
        using var db = NewDb();
        var service = NewService(
            db,
            CacheReturning(Game(7, "Silent Hill"), Game(8, "Silent Hill")),
            MatcherAnswering(_ => new ImportMatchResult(ImportMatchKinds.Ambiguous, null, [7, 8])));

        var jobId = await UploadAsync(service, Unidentified("Silent Hill"));
        var row = Assert.Single((await service.MatchAsync(UserId, jobId))!.Examined);

        await service.SetDecisionsAsync(UserId, jobId, new ImportDecisionsDto(
            [new ImportRowDecisionDto(row.Id, ImportDecisions.Import, 8, null)]));

        var resolved = Assert.Single((await service.GetReviewAsync(UserId, jobId))!.Rows);

        Assert.Equal(ImportMatchKinds.Matched, resolved.MatchKind);
        Assert.Equal(8, resolved.GameId);
        Assert.Empty(resolved.Candidates);
    }

    // ---------------------------------------------------------- the retention clock

    [Fact]
    public async Task CreateJobAsync_StartsTheJobsClockAtItsCreation()
    {
        // Left at default(DateTimeOffset) the column reads as two thousand years of silence, and
        // the retention sweep would delete every job on the tick after it was uploaded.
        using var db = NewDb();
        await UploadAsync(NewService(db), Export(Entry()));

        var job = await db.ImportJobs.SingleAsync();

        Assert.Equal(Midday, job.UpdatedAt);
    }

    [Fact]
    public async Task SetDecisionsAsync_MovesTheJobsClock_SoRetentionMeasuresSilenceAndNotAge()
    {
        // ImportRetention deletes a pending job a fortnight after this column last moved, so a
        // review somebody works through over several sittings has to keep pushing it forward. If
        // saving decisions stopped writing it the window would quietly become a deadline from
        // upload, and a part-finished review would be deleted along with every decision made on
        // it — which no other test here would catch, because the decisions themselves would still
        // be saved perfectly correctly.
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));
        var jobId = await UploadAsync(service, Export(Entry()));

        var row = Assert.Single((await service.GetReviewAsync(UserId, jobId))!.Rows);

        var later = Midday.AddDays(9);
        await new ImportService(db, CacheReturning(Game(379)), NoMatcher(), new FixedClock(later))
            .SetDecisionsAsync(UserId, jobId, new ImportDecisionsDto(
                [new ImportRowDecisionDto(row.Id, ImportDecisions.Import, null, null)]));

        var job = await db.ImportJobs.SingleAsync();

        Assert.Equal(Midday, job.CreatedAt);
        Assert.Equal(later, job.UpdatedAt);
    }

    [Fact]
    public async Task CommitAsync_SetsCompletedAtWithTheState()
    {
        // The two are one fact — "is this job over" — and CK_ImportJobs_Completion is what keeps
        // them saying it together. A terminal state written without a completion would be a row
        // the seven-day rule never selects and the MaxPendingJobs cap counts for ever. The
        // in-memory provider does not enforce check constraints, so the pairing is asserted here
        // rather than left to the one place that would catch it.
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));

        await service.CommitAsync(UserId, await UploadAsync(service, Export(Entry())));

        var job = await db.ImportJobs.SingleAsync();

        Assert.Equal(ImportJobStates.Done, job.State);
        Assert.Equal(Midday, job.CompletedAt);
    }

    [Fact]
    public async Task CancelAsync_SetsCompletedAtWithTheState()
    {
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));

        await service.CancelAsync(UserId, await UploadAsync(service, Export(Entry())));

        var job = await db.ImportJobs.SingleAsync();

        Assert.Equal(ImportJobStates.Cancelled, job.State);
        Assert.Equal(Midday, job.CompletedAt);
    }

    [Fact]
    public async Task CreateJobAsync_AJobThatIsNeitherPendingNorFinished_StillHoldsItsSlot()
    {
        // The cap and the sweep have to mean the same thing by "unfinished", or retention frees a
        // slot the counter never counted. Both now read CompletedAt.
        //
        // Constructed with the state ImportJobStates explicitly invites: "Adding mapping or
        // matching back for a preset that needs them is additive, which is why this is a string."
        // Such a job has no completion, so retention treats it as unfinished and will free it —
        // and the cap has to agree. Counting State == pending instead lets this upload through,
        // which is the whole of the divergence and what makes this test worth its length.
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));

        for (var i = 0; i < ImportService.MaxPendingJobs - 1; i++)
            await UploadAsync(service, Export(Entry()));

        db.ImportJobs.Add(new ImportJob
        {
            Id = Guid.NewGuid(),
            UserId = UserId,
            Source = ImportSources.Grouvee,
            FileName = "still-matching.json",
            State = "matching",
            RowCount = 1,
            CreatedAt = Midday,
            UpdatedAt = Midday
        });
        await db.SaveChangesAsync();

        await Assert.ThrowsAsync<ImportRejectedException>(
            () => UploadAsync(service, Export(Entry())));
    }

    // ------------------------------------------------ a closed job keeps no rows

    [Fact]
    public async Task CommitAsync_DeletesTheRowsItJustCommitted()
    {
        // The rows are the review's working state, not a record of it. Everything they held has
        // either become a library entry or been counted into SkippedCount, and nothing re-serves
        // them — so at up to MaxRows of jsonb per import they were much the largest thing this
        // feature stored, kept for a week after the last screen that could render them.
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));

        var jobId = await UploadAsync(service, Export(Entry()));
        Assert.NotEmpty(db.ImportRows);

        await service.CommitAsync(UserId, jobId);

        Assert.Empty(db.ImportRows);
    }

    [Fact]
    public async Task CommitAsync_KeepsTheJobItselfAndEveryCountOnIt()
    {
        // The other half of the same decision, and the half that is easy to break: deleting the
        // rows must leave the receipt. One row naming the file and saying how it went is what
        // /import lists, and it is now the whole of what retention keeps for seven days.
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));

        await service.CommitAsync(UserId, await UploadAsync(service, Export(Entry())));

        var job = Assert.Single(await service.GetJobsAsync(UserId));

        Assert.Equal(ImportJobStates.Done, job.State);
        Assert.Equal("grouvee_export.json", job.FileName);
        Assert.Equal(1, job.RowCount);
        Assert.Equal(1, job.ImportedCount);
        Assert.Equal(0, job.SkippedCount);
    }

    [Fact]
    public async Task CancelAsync_DeletesTheRowsNobodyDecided()
    {
        // A cancelled job has even less claim to its rows than a committed one: nothing they held
        // was written anywhere, so there is not even a library to reconcile them against.
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));

        var jobId = await UploadAsync(service, Export(Entry()));
        await service.CancelAsync(UserId, jobId);

        Assert.Empty(db.ImportRows);
        Assert.Equal(ImportJobStates.Cancelled, Assert.Single(db.ImportJobs).State);
    }

    [Fact]
    public async Task GetReviewAsync_ACommittedJob_IsNotFound()
    {
        // It has no rows left, so a review of it would render empty — and, worse, actionable: the
        // screen's heading says nothing is saved until you finish and it offers a commit button
        // that cannot work. The client links only pending jobs, so this is what a stale bookmark
        // gets, and 404 is what that screen already knows how to say.
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));

        var jobId = await UploadAsync(service, Export(Entry()));
        await service.CommitAsync(UserId, jobId);

        Assert.Null(await service.GetReviewAsync(UserId, jobId));
    }

    [Fact]
    public async Task GetReviewAsync_ACancelledJob_IsNotFound()
    {
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));

        var jobId = await UploadAsync(service, Export(Entry()));
        await service.CancelAsync(UserId, jobId);

        Assert.Null(await service.GetReviewAsync(UserId, jobId));
    }

    // -------------------------------------------------- a job swept mid-request

    // Until retention existed nothing could delete a job somebody was holding, so every method
    // here could read a job and then write to it without wondering whether it was still there.
    // The sweep runs on an hourly timer with no idea a request is in flight, so all three writes
    // now touch the job row itself and treat an update that matches nothing as "it is gone" —
    // which is the 404 each endpoint was already written to return.

    [Fact]
    public async Task SetDecisionsAsync_WhenTheJobIsSweptMidRequest_SaysSoRatherThanReportingASave()
    {
        // The rows are read in a second round trip, so a swept job leaves that query empty, the
        // loop over it doing nothing, and SaveChanges writing nothing at all. Without the job's
        // own clock in that SaveChanges this returns true, the endpoint answers 204, and the user
        // carries on ticking boxes on a job that no longer exists.
        var name = Guid.NewGuid().ToString();
        using var db = NewDb(name);
        using var sweeper = NewDb(name);

        var jobId = await UploadAsync(NewService(db), Export(Entry()));
        var row = await db.ImportRows.SingleAsync();

        var service = new ImportService(
            db, CacheReturning(Game(379)), NoMatcher(), new SweepingClock(Midday, () => Sweep(sweeper)));

        var saved = await service.SetDecisionsAsync(UserId, jobId, new ImportDecisionsDto(
            [new ImportRowDecisionDto(row.Id, ImportDecisions.Import, null, null)]));

        Assert.False(saved);
    }

    [Fact]
    public async Task CommitAsync_WhenTheJobIsSweptWhileItIsWriting_IsNotFoundRatherThanAnError()
    {
        // The real window, reproduced where it really is: WriteAsync asks the game cache for
        // metadata, which is IGDB-backed and can take seconds behind retries and a breaker. The
        // closing update then matches no row, and EF's concurrency exception is claimed by none of
        // the registered error handlers — so unhandled it is a 500 on a method that already has a
        // 404 for precisely this case.
        var name = Guid.NewGuid().ToString();
        using var db = NewDb(name);
        using var sweeper = NewDb(name);

        var jobId = await UploadAsync(NewService(db), Export(Entry()));

        var cache = Substitute.For<IGameCacheService>();
        cache.GetGamesAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                Sweep(sweeper);
                return new[] { Game(379) };
            });

        var result = await new ImportService(db, cache, NoMatcher(), new FixedClock(Midday))
            .CommitAsync(UserId, jobId);

        Assert.Null(result);
    }

    [Fact]
    public async Task CancelAsync_WhenTheJobIsSweptMidRequest_IsNotFoundRatherThanAnError()
    {
        // The mildest of the three — the sweep did what the request was asking for — and still a
        // 500 without the same handling.
        var name = Guid.NewGuid().ToString();
        using var db = NewDb(name);
        using var sweeper = NewDb(name);

        var jobId = await UploadAsync(NewService(db), Export(Entry()));

        var service = new ImportService(
            db, CacheReturning(Game(379)), NoMatcher(), new SweepingClock(Midday, () => Sweep(sweeper)));

        Assert.False(await service.CancelAsync(UserId, jobId));
    }

    // ---------------------------------------------------------------- scoping

    [Fact]
    public async Task GetReviewAsync_SomebodyElsesJob_IsNotFound()
    {
        // The same answer as a job that does not exist, so the endpoint cannot be used to ask
        // whether an id is in use.
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));
        var jobId = await UploadAsync(service, Export(Entry()));

        Assert.Null(await service.GetReviewAsync(OtherUserId, jobId));
        Assert.Null(await service.CommitAsync(OtherUserId, jobId));
        Assert.False(await service.CancelAsync(OtherUserId, jobId));
    }

    [Fact]
    public async Task CancelAsync_APendingJob_ClosesItWithoutWritingAnything()
    {
        using var db = NewDb();
        var service = NewService(db, CacheReturning(Game(379)));
        var jobId = await UploadAsync(service, Export(Entry()));

        Assert.True(await service.CancelAsync(UserId, jobId));
        Assert.Equal(ImportJobStates.Cancelled, db.ImportJobs.Single().State);
        Assert.Empty(db.UserGameEntries);
        Assert.False(await service.CancelAsync(UserId, jobId));
    }
}
