using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// What the export promises: one user's data and no other's, statuses as their permanent keys, and
/// a complete document even when there is nothing in it.
/// </summary>
/// <remarks>
/// The scoping test is the important one. Everything else here is a shape that would be noticed the
/// first time somebody opened the file; a document that quietly carried somebody else's rows would
/// not be, and it is the failure this feature could not recover from.
/// </remarks>
public class UserDataExporterTests
{
    private const string UserId = "user-1";
    private const string OtherUserId = "user-2";

    private static readonly DateTimeOffset Now = new(2026, 9, 7, 12, 0, 0, TimeSpan.Zero);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    /// <summary>
    /// A context whose statuses are the real ones: <c>EnsureCreated</c> applies the context's own
    /// <c>HasData</c>, so these tests resolve the same five keys the migration seeds rather than a
    /// local copy that could drift from them.
    /// </summary>
    private static ApplicationDbContext NewDb()
    {
        var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);
        db.Database.EnsureCreated();
        return db;
    }

    private static short StatusId(ApplicationDbContext db, string key) =>
        db.ListStatuses.Single(s => s.Key == key).Id;

    private static UserDataExporter NewExporter(ApplicationDbContext db) =>
        new(db, new FixedClock(Now));

    private static void AddAccount(
        ApplicationDbContext db,
        string userId,
        string email,
        string theme = "dark",
        string listView = ListViewModes.Tiles)
    {
        db.Users.Add(new ApplicationUser
        {
            Id = userId,
            UserName = email,
            Email = email,
            Theme = theme,
            ListView = listView
        });
        db.SaveChanges();
    }

    private static void AddEntry(
        ApplicationDbContext db,
        int gameId,
        string? status,
        short? score = null,
        DateTimeOffset? addedAt = null,
        string userId = UserId)
    {
        db.UserGameEntries.Add(new UserGameEntry
        {
            UserId = userId,
            GameId = gameId,
            StatusId = status is null ? null : StatusId(db, status),
            Score = score,
            AddedAt = addedAt ?? Now,
            StatusChangedAt = status is null ? null : addedAt ?? Now
        });
        db.SaveChanges();
    }

    /// <summary>One transition. `null` at either end is a real event: a first add, or a removal.</summary>
    private static void AddEvent(
        ApplicationDbContext db,
        int gameId,
        string? from,
        string? to,
        DateTimeOffset? at = null,
        string userId = UserId)
    {
        db.UserGameEvents.Add(new UserGameEvent
        {
            UserId = userId,
            GameId = gameId,
            FromStatusId = from is null ? null : StatusId(db, from),
            ToStatusId = to is null ? null : StatusId(db, to),
            OccurredAt = at ?? Now
        });
        db.SaveChanges();
    }

    /// <summary>
    /// One playthrough on the user's entry for a game, creating that entry if it is not there.
    /// </summary>
    private static void AddPlaythrough(
        ApplicationDbContext db,
        int gameId,
        string? type = PlaythroughTypeKeys.Normally,
        int? platformId = 6,
        int? minutesPlayed = 600,
        DateOnly? startedOn = null,
        DateOnly? finishedOn = null,
        string? notes = null,
        DateTimeOffset? createdAt = null,
        string userId = UserId)
    {
        var entry = db.UserGameEntries.FirstOrDefault(e => e.UserId == userId && e.GameId == gameId);
        if (entry is null)
        {
            AddEntry(db, gameId, status: null, userId: userId);
            entry = db.UserGameEntries.Single(e => e.UserId == userId && e.GameId == gameId);
        }

        db.UserGamePlaythroughs.Add(new UserGamePlaythrough
        {
            UserId = userId,
            Entry = entry,
            TypeId = type is null ? null : db.PlaythroughTypes.Single(t => t.Key == type).Id,
            PlatformId = platformId,
            MinutesPlayed = minutesPlayed,
            StartedOn = startedOn,
            FinishedOn = finishedOn,
            Notes = notes,
            CreatedAt = createdAt ?? Now,
            UpdatedAt = createdAt ?? Now
        });
        db.SaveChanges();
    }

    /// <summary>One review on the user's entry for a game, creating that entry if it is not there.</summary>
    private static void AddReview(
        ApplicationDbContext db,
        int gameId,
        string body = "Worth every hour.",
        bool hasSpoilers = false,
        string visibility = ReviewVisibility.Private,
        DateTimeOffset? createdAt = null,
        string userId = UserId)
    {
        var entry = db.UserGameEntries.FirstOrDefault(e => e.UserId == userId && e.GameId == gameId);
        if (entry is null)
        {
            AddEntry(db, gameId, status: null, userId: userId);
            entry = db.UserGameEntries.Single(e => e.UserId == userId && e.GameId == gameId);
        }

        db.Reviews.Add(new Review
        {
            UserId = userId,
            Entry = entry,
            Body = body,
            HasSpoilers = hasSpoilers,
            Visibility = visibility,
            CreatedAt = createdAt ?? Now,
            UpdatedAt = createdAt ?? Now
        });
        db.SaveChanges();
    }

    private static void AddWishlistItem(
        ApplicationDbContext db, int gameId, DateTimeOffset? at = null, string userId = UserId)
    {
        db.UserWishlistItems.Add(new UserWishlistItem
        {
            UserId = userId,
            GameId = gameId,
            AddedAt = at ?? Now
        });
        db.SaveChanges();
    }

    private static void AddHiddenPlatform(
        ApplicationDbContext db, int platformId, string userId = UserId)
    {
        db.UserHiddenPlatforms.Add(new UserHiddenPlatform
        {
            UserId = userId,
            IgdbPlatformId = platformId
        });
        db.SaveChanges();
    }

    private static void AddSortPreference(
        ApplicationDbContext db,
        string status,
        string sortKey,
        bool descending = true,
        string userId = UserId)
    {
        db.UserListSortPreferences.Add(new UserListSortPreference
        {
            UserId = userId,
            StatusId = StatusId(db, status),
            SortKey = sortKey,
            Descending = descending
        });
        db.SaveChanges();
    }

    [Fact]
    public async Task ExportAsync_AnotherUsersRows_AreNeverIncluded()
    {
        // The authorization boundary, asserted across every section at once. Both accounts have
        // rows in all five tables, so a section that forgot its `userId` predicate shows up here
        // as somebody else's game id rather than as a subtly wrong count.
        using var db = NewDb();

        AddAccount(db, UserId, "mine@test.local", theme: "light", listView: ListViewModes.Table);
        AddAccount(db, OtherUserId, "theirs@test.local", theme: "dark", listView: ListViewModes.Tiles);

        AddEntry(db, gameId: 11, status: ListStatusKeys.Playing, score: 8);
        AddEvent(db, gameId: 11, from: null, to: ListStatusKeys.Playing);
        AddPlaythrough(db, gameId: 11);
        AddReview(db, gameId: 11);
        AddWishlistItem(db, gameId: 12);
        AddHiddenPlatform(db, platformId: 13);
        AddSortPreference(db, ListStatusKeys.Playing, ListSortKeys.Score);

        AddEntry(db, gameId: 21, status: ListStatusKeys.Finished, score: 3, userId: OtherUserId);
        AddEvent(db, gameId: 21, from: null, to: ListStatusKeys.Finished, userId: OtherUserId);
        AddPlaythrough(db, gameId: 21, userId: OtherUserId);
        AddReview(db, gameId: 21, body: "Theirs.", userId: OtherUserId);
        AddWishlistItem(db, gameId: 22, userId: OtherUserId);
        AddHiddenPlatform(db, platformId: 23, userId: OtherUserId);
        AddSortPreference(db, ListStatusKeys.Finished, ListSortKeys.Title, userId: OtherUserId);

        var export = await NewExporter(db).ExportAsync(UserId, default);

        Assert.Equal("mine@test.local", export.Account.Email);
        Assert.Equal("light", export.Account.Theme);
        Assert.Equal(ListViewModes.Table, export.Account.ListView);

        Assert.Equal([11], export.Entries.Select(e => e.GameId));
        Assert.Equal([11], export.Events.Select(e => e.GameId));
        Assert.Equal([11], export.Playthroughs.Select(p => p.GameId));
        Assert.Equal([11], export.Reviews.Select(r => r.GameId));
        Assert.Equal([12], export.Wishlist.Select(w => w.GameId));
        Assert.Equal([13], export.HiddenPlatformIds);
        Assert.Equal([ListStatusKeys.Playing], export.ListSortPreferences.Select(p => p.Status));
    }

    [Fact]
    public async Task ExportAsync_UserWithNoRows_ReturnsACompleteEmptyDocument()
    {
        // Somebody who signed up a minute ago has to be able to export, and get a document that
        // says "nothing recorded" rather than one with holes in it.
        using var db = NewDb();
        AddAccount(db, UserId, "new@test.local");

        var export = await NewExporter(db).ExportAsync(UserId, default);

        Assert.Equal(Now, export.ExportedAt);
        Assert.Equal("new@test.local", export.Account.Email);
        Assert.Empty(export.Entries);
        Assert.Empty(export.Events);
        Assert.Empty(export.Playthroughs);
        Assert.Empty(export.Reviews);
        Assert.Empty(export.Wishlist);
        Assert.Empty(export.HiddenPlatformIds);
        Assert.Empty(export.ListSortPreferences);
    }

    [Fact]
    public async Task ExportAsync_EntryInAStatus_CarriesTheKeyRatherThanTheId()
    {
        // The id is a seeded constant of this database and would mean nothing anywhere else; the
        // key is the permanent contract (ADR 0018).
        using var db = NewDb();
        AddAccount(db, UserId, "mine@test.local");
        AddEntry(db, gameId: 11, status: ListStatusKeys.Finished, score: 9);

        var export = await NewExporter(db).ExportAsync(UserId, default);

        var entry = Assert.Single(export.Entries);
        Assert.Equal(ListStatusKeys.Finished, entry.Status);
        Assert.Equal(9, entry.Score);
    }

    [Fact]
    public async Task ExportAsync_EntryInNoList_ExportsANullStatus()
    {
        // An entry with no status is a game the user has data about but is not tracking (ADR
        // 0019). Null is the value, not an absence.
        using var db = NewDb();
        AddAccount(db, UserId, "mine@test.local");
        AddEntry(db, gameId: 11, status: null, score: 7);

        var export = await NewExporter(db).ExportAsync(UserId, default);

        var entry = Assert.Single(export.Entries);
        Assert.Null(entry.Status);
        Assert.Null(entry.StatusChangedAt);
        Assert.Equal(7, entry.Score);
    }

    [Fact]
    public async Task ExportAsync_FirstAddEvent_ExportsANullFromStatus()
    {
        using var db = NewDb();
        AddAccount(db, UserId, "mine@test.local");
        AddEvent(db, gameId: 11, from: null, to: ListStatusKeys.Backlog);

        var export = await NewExporter(db).ExportAsync(UserId, default);

        var recorded = Assert.Single(export.Events);
        Assert.Null(recorded.FromStatus);
        Assert.Equal(ListStatusKeys.Backlog, recorded.ToStatus);
    }

    [Fact]
    public async Task ExportAsync_RemovalEvent_ExportsANullToStatus()
    {
        // Leaving every list is a transition rather than a deletion, and the log says so at the
        // `to` end.
        using var db = NewDb();
        AddAccount(db, UserId, "mine@test.local");
        AddEvent(db, gameId: 11, from: ListStatusKeys.Dropped, to: null);

        var export = await NewExporter(db).ExportAsync(UserId, default);

        var recorded = Assert.Single(export.Events);
        Assert.Equal(ListStatusKeys.Dropped, recorded.FromStatus);
        Assert.Null(recorded.ToStatus);
    }

    [Fact]
    public async Task ExportAsync_Events_AreOrderedByWhenTheyHappened()
    {
        // A log is only a history if it is read in order, and the database's own order is not
        // defined. Inserted deliberately out of order here.
        using var db = NewDb();
        AddAccount(db, UserId, "mine@test.local");

        AddEvent(db, gameId: 11, from: ListStatusKeys.Playing, to: ListStatusKeys.Finished,
            at: Now.AddDays(-1));
        AddEvent(db, gameId: 11, from: null, to: ListStatusKeys.Backlog, at: Now.AddDays(-30));
        AddEvent(db, gameId: 11, from: ListStatusKeys.Backlog, to: ListStatusKeys.Playing,
            at: Now.AddDays(-10));

        var export = await NewExporter(db).ExportAsync(UserId, default);

        Assert.Equal(
            [ListStatusKeys.Backlog, ListStatusKeys.Playing, ListStatusKeys.Finished],
            export.Events.Select(e => e.ToStatus));
    }

    [Fact]
    public async Task ExportAsync_SortPreferences_CarryTheStatusKeyAndTheSort()
    {
        using var db = NewDb();
        AddAccount(db, UserId, "mine@test.local");
        AddSortPreference(db, ListStatusKeys.OnHold, ListSortKeys.StatusChanged, descending: false);

        var export = await NewExporter(db).ExportAsync(UserId, default);

        var preference = Assert.Single(export.ListSortPreferences);
        Assert.Equal(ListStatusKeys.OnHold, preference.Status);
        Assert.Equal(ListSortKeys.StatusChanged, preference.SortKey);
        Assert.False(preference.Descending);
    }

    [Fact]
    public async Task ExportAsync_Playthrough_CarriesItsTypeAsTheKeyRatherThanTheId()
    {
        // Same rule as the status keys, for the same reason: the seeded ids are constants of this
        // database and nothing outside it could interpret a `3`.
        using var db = NewDb();
        AddAccount(db, UserId, "mine@test.local");
        AddPlaythrough(
            db,
            gameId: 11,
            type: PlaythroughTypeKeys.Completionist,
            platformId: 48,
            minutesPlayed: 2400,
            startedOn: new DateOnly(2026, 5, 1),
            finishedOn: new DateOnly(2026, 6, 12),
            notes: "Every side quest.");

        var export = await NewExporter(db).ExportAsync(UserId, default);

        var playthrough = Assert.Single(export.Playthroughs);
        Assert.Equal(11, playthrough.GameId);
        Assert.Equal(PlaythroughTypeKeys.Completionist, playthrough.Type);
        Assert.Equal(48, playthrough.PlatformId);
        Assert.Equal(2400, playthrough.MinutesPlayed);
        Assert.Equal(new DateOnly(2026, 5, 1), playthrough.StartedOn);
        Assert.Equal(new DateOnly(2026, 6, 12), playthrough.FinishedOn);
        Assert.Equal("Every side quest.", playthrough.Notes);
    }

    [Fact]
    public async Task ExportAsync_UntypedPlaythrough_ExportsANullType()
    {
        // Null is a real value here — a run still in progress has no answer to "how thoroughly" —
        // so it exports as null rather than being dropped or filled in.
        using var db = NewDb();
        AddAccount(db, UserId, "mine@test.local");
        AddPlaythrough(db, gameId: 11, type: null, minutesPlayed: null);

        var export = await NewExporter(db).ExportAsync(UserId, default);

        var playthrough = Assert.Single(export.Playthroughs);
        Assert.Null(playthrough.Type);
        Assert.Null(playthrough.MinutesPlayed);
    }

    [Fact]
    public async Task ExportAsync_Playthroughs_AreOrderedByWhenTheyWereLogged()
    {
        // So two exports of unchanged data are byte-identical and can be diffed. Inserted out of
        // order here deliberately.
        using var db = NewDb();
        AddAccount(db, UserId, "mine@test.local");

        AddPlaythrough(db, gameId: 11, minutesPlayed: 200, createdAt: Now.AddDays(-1));
        AddPlaythrough(db, gameId: 12, minutesPlayed: 100, createdAt: Now.AddDays(-30));
        AddPlaythrough(db, gameId: 13, minutesPlayed: 300, createdAt: Now.AddDays(-10));

        var export = await NewExporter(db).ExportAsync(UserId, default);

        // Oldest first: 30 days ago, then 10, then 1.
        Assert.Equal([100, 300, 200], export.Playthroughs.Select(p => p.MinutesPlayed));
    }

    [Fact]
    public async Task ExportAsync_Review_CarriesTheProseAndItsVisibility()
    {
        using var db = NewDb();
        AddAccount(db, UserId, "mine@test.local");
        AddReview(
            db,
            gameId: 11,
            body: "The best side quests in the genre.",
            hasSpoilers: true,
            visibility: ReviewVisibility.Public);

        var export = await NewExporter(db).ExportAsync(UserId, default);

        var review = Assert.Single(export.Reviews);
        Assert.Equal(11, review.GameId);
        Assert.Equal("The best side quests in the genre.", review.Body);
        Assert.True(review.HasSpoilers);
        Assert.Equal(ReviewVisibility.Public, review.Visibility);
    }

    [Fact]
    public async Task ExportAsync_Reviews_AreOrderedByWhenTheyWereWritten()
    {
        using var db = NewDb();
        AddAccount(db, UserId, "mine@test.local");

        AddReview(db, gameId: 11, body: "Second", createdAt: Now.AddDays(-1));
        AddReview(db, gameId: 12, body: "First", createdAt: Now.AddDays(-30));
        AddReview(db, gameId: 13, body: "Third", createdAt: Now.AddHours(-1));

        var export = await NewExporter(db).ExportAsync(UserId, default);

        Assert.Equal(["First", "Second", "Third"], export.Reviews.Select(r => r.Body));
    }

    [Fact]
    public async Task ExportAsync_NoAccountRow_Throws()
    {
        // Callers arrive authenticated, so this is a broken invariant rather than a request to
        // answer. Failing beats handing back a document about an account that does not exist.
        using var db = NewDb();

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => NewExporter(db).ExportAsync(UserId, default));
    }
}
