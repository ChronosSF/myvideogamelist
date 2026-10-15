using System.Data;
using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// What the export promises: one user's data and no other's, statuses as their permanent keys, and
/// a complete document even when there is nothing in it.
/// </summary>
/// <remarks>
/// <para>
/// The scoping test is the important one. Everything else here is a shape that would be noticed the
/// first time somebody opened the file; a document that quietly carried somebody else's rows would
/// not be, and it is the failure this feature could not recover from.
/// </para>
/// <para>
/// What is deliberately <em>not</em> covered is the snapshot. The exporter reads every section in
/// one <c>REPEATABLE READ</c> transaction, and the in-memory provider has no isolation: a test that
/// deleted a job and its rows between two sections would tear the document here with the fix in
/// place. That is the line <c>UserOwnedDataTests</c> draws for a cascade and
/// <c>ImportRetentionTests</c> for the sweep's delete. What is pinned instead is the request — one
/// transaction, at that level, over before the export returns — which the provider's own
/// transaction manager would otherwise drop unseen. Whether PostgreSQL honours it is for the
/// integration tests (#104); until then it is the run by hand recorded on #95.
/// </para>
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
    /// <remarks>
    /// The exporter reads inside a transaction, and the in-memory provider has none: asked for one,
    /// it throws. Ignoring that warning, rather than opening the transaction behind a seam these
    /// tests step around, keeps them on the exporter's real path — the execution strategy, the
    /// transaction and the commit all run here, as no-ops — so what they prove is that the document
    /// is what it was.
    /// </remarks>
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

    private static short StatusId(ApplicationDbContext db, string key) =>
        db.ListStatuses.Single(s => s.Key == key).Id;

    private static UserDataExporter NewExporter(ApplicationDbContext db) =>
        new(db, new FixedClock(Now));

    private static void AddAccount(
        ApplicationDbContext db,
        string userId,
        string email,
        string theme = "dark",
        string listView = ListViewModes.Tiles,
        string userName = "someone",
        string profileVisibility = ProfileVisibility.Private)
    {
        db.Users.Add(new ApplicationUser
        {
            Id = userId,
            UserName = userName,
            Email = email,
            Theme = theme,
            ListView = listView,
            ProfileVisibility = profileVisibility
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

    private static void AddFavourite(
        ApplicationDbContext db, int gameId, DateTimeOffset? at = null, string userId = UserId)
    {
        db.UserFavourites.Add(new UserFavourite
        {
            UserId = userId,
            GameId = gameId,
            AddedAt = at ?? Now
        });
        db.SaveChanges();
    }

    private static void AddListName(
        ApplicationDbContext db, string status, string name, string userId = UserId)
    {
        db.UserListSettings.Add(new UserListSetting
        {
            UserId = userId,
            StatusId = StatusId(db, status),
            DisplayName = name
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

        AddAccount(db, UserId, "mine@test.local", theme: "light", listView: ListViewModes.Table,
            userName: "mine", profileVisibility: ProfileVisibility.Public);
        AddAccount(db, OtherUserId, "theirs@test.local", theme: "dark", listView: ListViewModes.Tiles,
            userName: "theirs");

        AddEntry(db, gameId: 11, status: ListStatusKeys.Playing, score: 8);
        AddEvent(db, gameId: 11, from: null, to: ListStatusKeys.Playing);
        AddPlaythrough(db, gameId: 11);
        AddReview(db, gameId: 11);
        AddWishlistItem(db, gameId: 12);
        AddFavourite(db, gameId: 14);
        AddSortPreference(db, ListStatusKeys.Playing, ListSortKeys.Score);
        AddListName(db, ListStatusKeys.Backlog, "Someday");

        AddEntry(db, gameId: 21, status: ListStatusKeys.Finished, score: 3, userId: OtherUserId);
        AddEvent(db, gameId: 21, from: null, to: ListStatusKeys.Finished, userId: OtherUserId);
        AddPlaythrough(db, gameId: 21, userId: OtherUserId);
        AddReview(db, gameId: 21, body: "Theirs.", userId: OtherUserId);
        AddWishlistItem(db, gameId: 22, userId: OtherUserId);
        AddFavourite(db, gameId: 24, userId: OtherUserId);
        AddSortPreference(db, ListStatusKeys.Finished, ListSortKeys.Title, userId: OtherUserId);
        AddListName(db, ListStatusKeys.Dropped, "Nope", userId: OtherUserId);

        var export = await NewExporter(db).ExportAsync(UserId, default);

        Assert.Equal("mine@test.local", export.Account.Email);
        Assert.Equal("mine", export.Account.UserName);
        Assert.Equal("light", export.Account.Theme);
        Assert.Equal(ListViewModes.Table, export.Account.ListView);

        // The name the user chose and the answer they gave about publishing are both data they
        // entered, so both travel with the rest of it (ADR 0027).
        Assert.Equal(ProfileVisibility.Public, export.Account.ProfileVisibility);

        Assert.Equal([11], export.Entries.Select(e => e.GameId));
        Assert.Equal([11], export.Events.Select(e => e.GameId));
        Assert.Equal([11], export.Playthroughs.Select(p => p.GameId));
        Assert.Equal([11], export.Reviews.Select(r => r.GameId));
        Assert.Equal([12], export.Wishlist.Select(w => w.GameId));
        Assert.Equal([14], export.Favourites.Select(f => f.GameId));
        Assert.Equal([ListStatusKeys.Playing], export.ListSortPreferences.Select(p => p.Status));
        Assert.Equal([ListStatusKeys.Backlog], export.ListNames.Select(n => n.Status));
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
        Assert.Empty(export.Favourites);
        Assert.Empty(export.ListSortPreferences);
        Assert.Empty(export.ListNames);
    }

    [Fact]
    public async Task ExportAsync_ListNames_CarryTheStatusKeyAndTheName()
    {
        using var db = NewDb();
        AddAccount(db, UserId, "mine@test.local");
        AddListName(db, ListStatusKeys.Finished, "Beaten");
        AddListName(db, ListStatusKeys.Backlog, "Pile of Shame");

        var export = await NewExporter(db).ExportAsync(UserId, default);

        // Lifecycle order, as the lists read in the UI.
        Assert.Equal(
            [(ListStatusKeys.Backlog, "Pile of Shame"), (ListStatusKeys.Finished, "Beaten")],
            export.ListNames.Select(n => (n.Status, n.DisplayName)));
    }

    [Fact]
    public async Task ExportAsync_Favourites_AreOrderedByWhenTheyWereMadeFavourites()
    {
        // Oldest first like every other section, so two exports of unchanged data are identical —
        // not newest first as the profile shows them, which is a presentation choice.
        using var db = NewDb();
        AddAccount(db, UserId, "mine@test.local");

        AddFavourite(db, gameId: 11, at: Now.AddDays(-1));
        AddFavourite(db, gameId: 12, at: Now.AddDays(-30));

        var export = await NewExporter(db).ExportAsync(UserId, default);

        Assert.Equal([12, 11], export.Favourites.Select(f => f.GameId));
        Assert.Equal(Now.AddDays(-30), export.Favourites[0].AddedAt);
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
    public async Task ExportAsync_Entry_CarriesItsOwnershipAndNotes()
    {
        // The projection is written by hand, so a column added to the entry reaches the document
        // only if somebody adds it there. This is the test that notices when they do not.
        using var db = NewDb();
        AddAccount(db, UserId, "mine@test.local");
        db.UserGameEntries.Add(new UserGameEntry
        {
            UserId = UserId,
            GameId = 11,
            Ownership = OwnershipKinds.Subscription,
            Notes = "Leaves the service in March.",
            AddedAt = Now
        });
        db.SaveChanges();

        var export = await NewExporter(db).ExportAsync(UserId, default);

        var entry = Assert.Single(export.Entries);
        Assert.Equal(OwnershipKinds.Subscription, entry.Ownership);
        Assert.Equal("Leaves the service in March.", entry.Notes);
    }

    [Fact]
    public async Task ExportAsync_Entry_CarriesItsOrigin()
    {
        // Same trap as the ownership and notes above, and a worse one to fall into: without the
        // origin, an imported library reads as a history that lost its events rather than as one
        // that never had any (ADR 0026, ADR 0037).
        using var db = NewDb();
        AddAccount(db, UserId, "mine@test.local");
        db.UserGameEntries.Add(new UserGameEntry
        {
            UserId = UserId,
            GameId = 11,
            Origin = EntryOrigins.Grouvee,
            AddedAt = Now
        });
        db.SaveChanges();

        var export = await NewExporter(db).ExportAsync(UserId, default);

        Assert.Equal(EntryOrigins.Grouvee, Assert.Single(export.Entries).Origin);
    }

    [Fact]
    public async Task ExportAsync_EntryTheUserMadeThemselves_ExportsOriginManual()
    {
        // The default has to survive into the document as a value rather than as an empty string:
        // every row written before the column existed is manual, and says so.
        using var db = NewDb();
        AddAccount(db, UserId, "mine@test.local");
        AddEntry(db, gameId: 11, status: null, score: 7);

        var export = await NewExporter(db).ExportAsync(UserId, default);

        Assert.Equal(EntryOrigins.Manual, Assert.Single(export.Entries).Origin);
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

        var thrown = await Assert.ThrowsAsync<InvalidOperationException>(
            () => NewExporter(db).ExportAsync(UserId, default));

        // The message as well as the type, because the in-memory provider throws this type too when
        // asked for a transaction. Until NewDb learned to ignore that, a bare type check passed on
        // it without the account ever being read.
        Assert.StartsWith("No account row", thrown.Message);
    }

    /// <summary>
    /// A transaction manager that records what it is asked for and opens nothing.
    /// </summary>
    /// <remarks>
    /// The in-memory provider's own manager never sees an isolation level:
    /// <c>BeginTransactionAsync(IsolationLevel)</c> hands the level on only to a relational manager,
    /// and calls the parameterless overload on any other. So this one is relational, which is all it
    /// takes for the level to arrive where a test can read it.
    /// </remarks>
    private sealed class RecordingTransactions : IRelationalTransactionManager
    {
        public List<RecordedTransaction> Begun { get; } = [];

        public IDbContextTransaction? CurrentTransaction => null;

        public IDbContextTransaction BeginTransaction() => Begin(IsolationLevel.Unspecified);

        public Task<IDbContextTransaction> BeginTransactionAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(Begin(IsolationLevel.Unspecified));

        public IDbContextTransaction BeginTransaction(IsolationLevel isolationLevel) => Begin(isolationLevel);

        public Task<IDbContextTransaction> BeginTransactionAsync(
            IsolationLevel isolationLevel, CancellationToken cancellationToken = default) =>
            Task.FromResult(Begin(isolationLevel));

        private IDbContextTransaction Begin(IsolationLevel isolationLevel)
        {
            var transaction = new RecordedTransaction(isolationLevel);
            Begun.Add(transaction);
            return transaction;
        }

        public void ResetState() { }

        public Task ResetStateAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;

        // Nothing the exporter calls. Throwing rather than pretending means a call to any of them
        // fails the test that made it instead of passing over it.
        public void CommitTransaction() => throw new NotSupportedException();

        public Task CommitTransactionAsync(CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public void RollbackTransaction() => throw new NotSupportedException();

        public Task RollbackTransactionAsync(CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public IDbContextTransaction? UseTransaction(DbTransaction? transaction) =>
            throw new NotSupportedException();

        public IDbContextTransaction? UseTransaction(DbTransaction? transaction, Guid transactionId) =>
            throw new NotSupportedException();

        public Task<IDbContextTransaction?> UseTransactionAsync(
            DbTransaction? transaction, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<IDbContextTransaction?> UseTransactionAsync(
            DbTransaction? transaction, Guid transactionId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }

    /// <summary>
    /// One transaction <see cref="RecordingTransactions"/> handed out: its level, and whether it was
    /// ended — committed, rolled back or disposed, any of which closes a real one.
    /// </summary>
    private sealed class RecordedTransaction(IsolationLevel isolationLevel) : IDbContextTransaction
    {
        public IsolationLevel IsolationLevel { get; } = isolationLevel;

        public bool Ended { get; private set; }

        public Guid TransactionId { get; } = Guid.NewGuid();

        public void Commit() => Ended = true;

        public Task CommitAsync(CancellationToken cancellationToken = default) => End();

        public void Rollback() => Ended = true;

        public Task RollbackAsync(CancellationToken cancellationToken = default) => End();

        public void Dispose() => Ended = true;

        public ValueTask DisposeAsync() => new(End());

        private Task End()
        {
            Ended = true;
            return Task.CompletedTask;
        }
    }

    [Fact]
    public async Task ExportAsync_Transaction_IsOneRepeatableReadEndedBeforeItReturns()
    {
        // The request, not the snapshot: one transaction, at the level that makes it a snapshot,
        // over before the document goes back to be written. The level is the whole of the fix and
        // the one thing a refactor could drop with every other test still green — the sweep's own
        // BeginTransactionAsync takes none, and copying it would bring #95 back. Whether PostgreSQL
        // honours the level is beyond this provider; see the class remarks.
        using var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .ReplaceService<IDbContextTransactionManager, RecordingTransactions>()
                .Options);
        db.Database.EnsureCreated();
        AddAccount(db, UserId, "mine@test.local");

        await NewExporter(db).ExportAsync(UserId, default);

        var transactions = (RecordingTransactions)db.GetService<IDbContextTransactionManager>();
        var transaction = Assert.Single(transactions.Begun);
        Assert.Equal(IsolationLevel.RepeatableRead, transaction.IsolationLevel);
        Assert.True(transaction.Ended);
    }
}
