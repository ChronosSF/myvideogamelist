using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using MyVideoGameList.Server.Services.Import;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// One account's export, imported into another, and exported again: what the import brings back and
/// what it is meant to leave behind (ADR 0083).
/// </summary>
/// <remarks>
/// <para>
/// The document is the exporter's own output, serialised as the endpoint serialises it, so a
/// property renamed on either side of the round trip fails here rather than reading as null in
/// somebody's file. That is the guard <see cref="MyVideoGameListImportSource"/> leans on: it reads
/// the exporter's own records, which keeps today's shape in step by construction and leaves only a
/// file saved under an older one to go quietly missing a field.
/// </para>
/// <para>
/// The losses are asserted as firmly as what survives. The import writes no events, stamps no
/// <c>ScoredAt</c> and no <c>StatusChangedAt</c>, and creates no review, on purpose (ADR 0026, 0062,
/// 0037) — so a change that starts restoring any of them from our own file has to fail a test and
/// come with a record of why, rather than be noticed in review.
/// </para>
/// </remarks>
public class ExportRoundTripTests
{
    private const string Alice = "user-a";
    private const string Bob = "user-b";

    private static readonly DateTimeOffset Now = new(2026, 11, 4, 12, 0, 0, TimeSpan.Zero);

    /// <summary>As the endpoint writes it: MVC's defaults, which are the web ones.</summary>
    private static readonly JsonSerializerOptions Wire = new(JsonSerializerDefaults.Web);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    /// <summary>
    /// A context with the real seeded statuses and types, which ignores the exporter's transaction
    /// as <c>UserDataExporterTests</c> explains.
    /// </summary>
    private static ApplicationDbContext NewDb()
    {
        var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options);
        db.Database.EnsureCreated();
        return db;
    }

    private static ImportService NewImport(ApplicationDbContext db)
    {
        var cache = Substitute.For<IGameCacheService>();
        cache.GetGamesAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>())
            .Returns(call => call.Arg<IEnumerable<int>>().Select(id => Game(id)).ToList());

        return new ImportService(db, cache, Substitute.For<IImportMatcher>(), new FixedClock(Now));
    }

    private static GameDto Game(int id) =>
        new(id, $"Game {id}", null, null, null, null, null, null, null, null, null, null, null,
            Platforms: [new PlatformDto(48, "PlayStation 4", "PS4", null, null)], Genres: [], Developers: [], Publishers: [], Details: null);

    private static short StatusId(ApplicationDbContext db, string key) =>
        db.ListStatuses.Single(s => s.Key == key).Id;

    private static DateTimeOffset On(int year, int month, int day) => new(year, month, day, 9, 30, 0, TimeSpan.Zero);

    private static void AddAccount(ApplicationDbContext db, string id, string userName, string? bio = null)
    {
        db.Users.Add(new ApplicationUser
        {
            Id = id,
            UserName = userName,
            Email = $"{userName}@test.local",
            Bio = bio,
            CreatedAt = On(2023, 1, 1)
        });
        db.SaveChanges();
    }

    private static void Cache(ApplicationDbContext db, int gameId, string title, DateOnly? released = null)
    {
        db.CachedGames.Add(new CachedGame
        {
            GameId = gameId,
            Payload = "{}",
            Title = title,
            ReleaseDate = released,
            RefreshedAt = Now
        });
        db.SaveChanges();
    }

    /// <summary>
    /// A library with something in every section the export has, and some of each thing the import
    /// cannot carry: a scored and dated move, a hand-placed game, a review, a tag, a run's platform
    /// and notes, a favourite's place in the showcase.
    /// </summary>
    private static void RecordAliceEverything(ApplicationDbContext db)
    {
        AddAccount(db, Alice, "alice");

        var finished = new UserGameEntry
        {
            UserId = Alice,
            GameId = 100,
            StatusId = StatusId(db, ListStatusKeys.Finished),
            Score = 8,
            ScoredAt = On(2024, 2, 1),
            Ownership = OwnershipKinds.Owned,
            Notes = "Loved it",
            AddedAt = On(2024, 1, 2),
            StatusChangedAt = On(2024, 2, 1)
        };
        var playing = new UserGameEntry
        {
            UserId = Alice,
            GameId = 200,
            StatusId = StatusId(db, ListStatusKeys.Playing),
            AddedAt = On(2024, 3, 4),
            StatusChangedAt = On(2024, 3, 4),
            Position = 1000
        };
        var unlisted = new UserGameEntry
        {
            UserId = Alice,
            GameId = 300,
            Score = 6,
            ScoredAt = On(2024, 4, 1),
            AddedAt = On(2024, 4, 1)
        };
        db.UserGameEntries.AddRange(finished, playing, unlisted);

        db.UserGameEvents.Add(new UserGameEvent
        {
            UserId = Alice,
            GameId = 100,
            FromStatusId = null,
            ToStatusId = StatusId(db, ListStatusKeys.Finished),
            OccurredAt = On(2024, 2, 1)
        });

        db.UserGamePlaythroughs.Add(new UserGamePlaythrough
        {
            UserId = Alice,
            Entry = finished,
            TypeId = db.PlaythroughTypes.Single(t => t.Key == PlaythroughTypeKeys.Completionist).Id,
            PlatformId = 48,
            MinutesPlayed = 1200,
            StartedOn = new DateOnly(2024, 1, 5),
            FinishedOn = new DateOnly(2024, 2, 1),
            Notes = "Every trophy",
            CreatedAt = On(2024, 2, 1),
            UpdatedAt = On(2024, 2, 1)
        });

        db.Reviews.Add(new Review
        {
            UserId = Alice,
            Entry = finished,
            Body = "A masterpiece.",
            HasSpoilers = true,
            Visibility = ReviewVisibility.Public,
            CreatedAt = On(2024, 2, 2),
            UpdatedAt = On(2024, 2, 2)
        });

        var tag = new Tag { UserId = Alice, Name = "cosy", NormalizedName = TagNamePolicy.Key("cosy"), CreatedAt = On(2024, 3, 5) };
        db.Tags.Add(tag);
        db.UserGameEntryTags.Add(new UserGameEntryTag { UserId = Alice, Entry = playing, Tag = tag, AddedAt = On(2024, 3, 5) });

        db.UserWishlistItems.AddRange(
            new UserWishlistItem { UserId = Alice, GameId = 200, AddedAt = On(2023, 12, 1) },
            new UserWishlistItem { UserId = Alice, GameId = 400, AddedAt = On(2024, 5, 6) });

        db.UserFavourites.Add(new UserFavourite { UserId = Alice, GameId = 100, AddedAt = On(2024, 2, 3), Position = 1000 });

        db.SaveChanges();
    }

    private static async Task<string> ExportJsonAsync(ApplicationDbContext db, string userId) =>
        JsonSerializer.Serialize(
            await new UserDataExporter(db, new FixedClock(Now)).ExportAsync(userId, CancellationToken.None),
            Wire);

    /// <summary>Alice's export, uploaded and committed by Bob with every row as the review left it.</summary>
    private static async Task<UserDataExportDto> RoundTripAsync(ApplicationDbContext db)
    {
        RecordAliceEverything(db);
        AddAccount(db, Bob, "bob");

        var import = NewImport(db);
        var job = await import.CreateJobAsync(Bob, "myvideogamelist-export.json", await ExportJsonAsync(db, Alice));
        await import.CommitAsync(Bob, job.Id);

        return await new UserDataExporter(db, new FixedClock(Now)).ExportAsync(Bob, CancellationToken.None);
    }

    // ---------------------------------------------------------------- the round trip

    [Fact]
    public async Task RoundTrip_EveryGame_ComesBackInItsListWithItsScoreAndDate()
    {
        using var db = NewDb();

        var bob = await RoundTripAsync(db);

        var entries = bob.Entries.ToDictionary(e => e.GameId);
        Assert.Equal(new[] { 100, 200, 300, 400 }, entries.Keys.Order());

        Assert.Equal(ListStatusKeys.Finished, entries[100].Status);
        Assert.Equal(8, entries[100].Score);
        Assert.Equal(On(2024, 1, 2), entries[100].AddedAt);

        Assert.Equal(ListStatusKeys.Playing, entries[200].Status);
        Assert.Equal(On(2024, 3, 4), entries[200].AddedAt);

        // A game in no list stays in none, keeping its score.
        Assert.Null(entries[300].Status);
        Assert.Equal(6, entries[300].Score);

        // A game only wishlisted gets an entry in no list, as every import's does, dated as wished for.
        Assert.Null(entries[400].Status);
        Assert.Equal(On(2024, 5, 6), entries[400].AddedAt);
    }

    [Fact]
    public async Task RoundTrip_TheReview_ComesBackAfterTheNotesAndNotAsAReview()
    {
        using var db = NewDb();

        var bob = await RoundTripAsync(db);

        Assert.Equal("Loved it\n\nA masterpiece.", bob.Entries.Single(e => e.GameId == 100).Notes);
        Assert.Empty(bob.Reviews);
    }

    [Fact]
    public async Task RoundTrip_ARun_ComesBackWithItsDatesMinutesAndTypeOnly()
    {
        using var db = NewDb();

        var bob = await RoundTripAsync(db);

        var run = Assert.Single(bob.Playthroughs);
        Assert.Equal(100, run.GameId);
        Assert.Equal(PlaythroughTypeKeys.Completionist, run.Type);
        Assert.Equal(1200, run.MinutesPlayed);
        Assert.Equal(new DateOnly(2024, 1, 5), run.StartedOn);
        Assert.Equal(new DateOnly(2024, 2, 1), run.FinishedOn);

        // The export holds the platform's id and the canonical row a name, so it stays behind with
        // the run's notes.
        Assert.Null(run.PlatformId);
        Assert.Null(run.Notes);
    }

    [Fact]
    public async Task RoundTrip_TheWishlistAndFavourites_ComeBackUnplacedAndDatedByTheRow()
    {
        using var db = NewDb();

        var bob = await RoundTripAsync(db);

        Assert.Equal(new[] { 200, 400 }, bob.Wishlist.Select(w => w.GameId).Order());

        // One date per row: a wishlisted game that is also in a list takes the entry's.
        Assert.Equal(On(2024, 3, 4), bob.Wishlist.Single(w => w.GameId == 200).AddedAt);
        Assert.Equal(On(2024, 5, 6), bob.Wishlist.Single(w => w.GameId == 400).AddedAt);

        var favourite = Assert.Single(bob.Favourites);
        Assert.Equal(100, favourite.GameId);
        Assert.Null(favourite.Position);
    }

    [Fact]
    public async Task RoundTrip_LeavesTheHistoryBehindAndSaysSoInTheOrigin()
    {
        // ADR 0026 and 0062: an import writes no transition and dates no score, from our own file
        // as from anybody's. The origin is what says so to everything that reads the history later.
        using var db = NewDb();

        var bob = await RoundTripAsync(db);

        Assert.Empty(bob.Events);

        var entries = bob.Entries.ToDictionary(e => e.GameId);
        Assert.All(bob.Entries, e => Assert.Null(e.ScoredAt));
        Assert.All(bob.Entries, e => Assert.Null(e.StatusChangedAt));
        Assert.Equal(EntryOrigins.MyVideoGameList, entries[100].Origin);
        Assert.Equal(EntryOrigins.MyVideoGameList, entries[200].Origin);

        // No status written, so nothing eventless to flag.
        Assert.Equal(EntryOrigins.Manual, entries[300].Origin);
    }

    [Fact]
    public async Task RoundTrip_LeavesBehindWhatTheRowHasNoFieldFor()
    {
        using var db = NewDb();

        var bob = await RoundTripAsync(db);

        Assert.All(bob.Entries, e => Assert.Null(e.Ownership));
        Assert.All(bob.Entries, e => Assert.Null(e.Position));
        Assert.Empty(bob.Tags);
        Assert.Empty(bob.EntryTags);
    }

    // ---------------------------------------------------------------- the upload

    [Fact]
    public async Task CreateJobAsync_OurExport_IsReadAsOursAndNamedFromTheCache()
    {
        using var db = NewDb();
        RecordAliceEverything(db);
        AddAccount(db, Bob, "bob");
        Cache(db, 100, "Bloodborne", new DateOnly(2015, 3, 24));

        var import = NewImport(db);
        var job = await import.CreateJobAsync(Bob, "renamed.json", await ExportJsonAsync(db, Alice));

        Assert.Equal(ImportSources.MyVideoGameList, job.Source);

        var rows = db.ImportRows.ToDictionary(r => r.GameId!.Value);
        Assert.Equal("Bloodborne", rows[100].Title);

        // A game the cache has never held is named by its id: the upload asks IGDB for nothing.
        Assert.Equal("IGDB game 200", rows[200].Title);

        var review = await import.GetReviewAsync(Bob, job.Id);
        Assert.Equal(2015, review!.Rows.Single(r => r.GameId == 100).ReleaseYear);
    }

    [Fact]
    public async Task CreateJobAsync_OurExportWhoseBioMentionsGrouvee_IsStillOurs()
    {
        // Grouvee's fingerprint is its name anywhere in the head, and the account section, bio
        // included, is near the top of ours.
        using var db = NewDb();
        AddAccount(db, Alice, "alice", bio: "Moved here from Grouvee.");
        db.UserGameEntries.Add(new UserGameEntry { UserId = Alice, GameId = 100, AddedAt = On(2024, 1, 2) });
        db.SaveChanges();
        AddAccount(db, Bob, "bob");

        var job = await NewImport(db).CreateJobAsync(Bob, "export.json", await ExportJsonAsync(db, Alice));

        Assert.Equal(ImportSources.MyVideoGameList, job.Source);
    }

    [Fact]
    public async Task CreateJobAsync_AnExportWithNothingInIt_IsRefusedAsEmpty()
    {
        using var db = NewDb();
        AddAccount(db, Alice, "alice");
        AddAccount(db, Bob, "bob");
        var document = await ExportJsonAsync(db, Alice);

        var refused = await Assert.ThrowsAsync<ImportRejectedException>(
            () => NewImport(db).CreateJobAsync(Bob, "export.json", document));

        Assert.Equal("That export has no games in it.", refused.Message);
    }
}
