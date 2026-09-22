using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
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

    private static ApplicationDbContext NewDb()
    {
        var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);
        db.Database.EnsureCreated();
        return db;
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

    private static ImportService NewService(ApplicationDbContext db, IGameCacheService? cache = null) =>
        new(db, cache ?? CacheReturning(), new FixedClock(Midday));

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

    private static string Entry(
        int igdbId = 379,
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
    public async Task CreateJobAsync_AMatchedRow_IsPreCheckedAndAnUnmatchedOneIsNot()
    {
        using var db = NewDb();
        var service = NewService(db);

        var jobId = await UploadAsync(service, Export(Entry(), Entry(name: "No Id", igdbId: 0).Replace("\"igdb_id\": 0", "\"igdb_id\": null")));
        var review = await service.GetReviewAsync(UserId, jobId);

        var matched = Assert.Single(review!.Rows, r => r.MatchKind == ImportMatchKinds.Matched);
        var unmatched = Assert.Single(review.Rows, r => r.MatchKind == ImportMatchKinds.Unmatched);

        Assert.Equal(ImportDecisions.Import, matched.Decision);
        Assert.Equal(ImportDecisions.Skip, unmatched.Decision);
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
            Entry(name: "Unknown Game").Replace("\"igdb_id\": 379", "\"igdb_id\": null")));

        var row = Assert.Single((await service.GetReviewAsync(UserId, jobId))!.Rows);
        await service.SetDecisionsAsync(UserId, jobId, new ImportDecisionsDto(
            [new ImportRowDecisionDto(row.Id, ImportDecisions.Import, 42, null)]));

        await service.CommitAsync(UserId, jobId);

        Assert.Equal(42, Assert.Single(db.UserGameEntries).GameId);
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
