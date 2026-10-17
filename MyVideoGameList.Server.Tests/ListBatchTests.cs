using System.ComponentModel.DataAnnotations;
using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Diagnostics;
using MyVideoGameList.Server.Controllers;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// A change of status made to several games at once (ADR 0055): one transaction, an event for each
/// game that moved and none for one already there, nothing created and nobody else's entry reached, a
/// row deleted mid-request answered honestly, and the bounds the API holds the request to.
/// </summary>
public class ListBatchTests
{
    private const string UserId = "user-1";
    private const string OtherUserId = "user-2";

    private static readonly DateTimeOffset Midday = new(2026, 3, 14, 12, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset LastMonth = Midday.AddDays(-30);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    /// <summary>A second later every time it is asked, so a batch that asked once per game would show it.</summary>
    private sealed class TickingClock(DateTimeOffset start) : TimeProvider
    {
        private DateTimeOffset _next = start;

        public override DateTimeOffset GetUtcNow()
        {
            var now = _next;
            _next = _next.AddSeconds(1);
            return now;
        }
    }

    private static DbContextOptions<ApplicationDbContext> Options(string name, params IInterceptor[] interceptors) =>
        new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(name)
            .AddInterceptors(interceptors)
            .Options;

    /// <summary>
    /// A context on the named database with the statuses seeded — <c>EnsureCreated</c> is what applies
    /// the seed on the in-memory provider, and it does nothing the second time.
    /// </summary>
    private static ApplicationDbContext NewDb(string? name = null, params IInterceptor[] interceptors)
    {
        var db = new ApplicationDbContext(Options(name ?? Guid.NewGuid().ToString(), interceptors));
        db.Database.EnsureCreated();
        return db;
    }

    private static ListService NewService(ApplicationDbContext db, TimeProvider? clock = null) =>
        new(db, Substitute.For<IGameCacheService>(), clock ?? new FixedClock(Midday));

    private static short StatusId(ApplicationDbContext db, string key) =>
        db.ListStatuses.Single(s => s.Key == key).Id;

    /// <summary>An entry as last month left it: in <paramref name="status"/>, or in no list for null.</summary>
    private static async Task AddEntryAsync(
        ApplicationDbContext db,
        string userId,
        int gameId,
        string? status,
        int? position = null,
        short? score = null,
        string? ownership = null)
    {
        db.UserGameEntries.Add(new UserGameEntry
        {
            UserId = userId,
            GameId = gameId,
            StatusId = status is null ? null : StatusId(db, status),
            Position = position,
            Score = score,
            Ownership = ownership,
            AddedAt = LastMonth,
            StatusChangedAt = status is null ? null : LastMonth
        });
        await db.SaveChangesAsync();
    }

    private static Dictionary<int, string> Outcomes(IEnumerable<StatusChangeDto> results) =>
        results.ToDictionary(r => r.GameId, r => r.Outcome);

    /// <summary>
    /// Before each save of the context it is attached to, deletes the next of the given games' entries
    /// through a second context — "delete my data" landing between the batch's read and its save — and
    /// fails the save the way PostgreSQL does, counting the saves it saw.
    /// </summary>
    /// <remarks>
    /// On PostgreSQL the save's <c>UPDATE</c> of that row finds nothing, EF reports a concurrency
    /// failure naming the entry, and the transaction is rolled back with nothing written. The in-memory
    /// provider cannot play the last part: it is not transactional, applies a save's inserts — the
    /// events — before it reaches the update that fails, and keeps them, so the retry would insert them
    /// twice. The failure is therefore raised here, before the provider writes anything, and only for a
    /// save that writes the row, since a save that does not would not notice it go. That the real
    /// provider reports a deleted row this way is <c>HandOrderTests</c>' to show, on rows alone.
    /// </remarks>
    private sealed class DeleteBeforeSaves(string databaseName, params int[] gameIds) : SaveChangesInterceptor
    {
        public int Saves { get; private set; }

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            Saves++;
            if (Saves > gameIds.Length) return result;

            var gameId = gameIds[Saves - 1];
            await using (var other = new ApplicationDbContext(Options(databaseName)))
            {
                other.UserGameEntries.RemoveRange(other.UserGameEntries.Where(e => e.GameId == gameId));
                await other.SaveChangesAsync(cancellationToken);
            }

            var written = eventData.Context!.ChangeTracker.Entries<UserGameEntry>()
                .Where(e => e.Entity.GameId == gameId && e.State == EntityState.Modified)
                .Cast<EntityEntry>()
                .ToList();

            return written.Count == 0 ? result : throw new RowGone(written);
        }
    }

    /// <summary>
    /// The concurrency failure EF raises for a row an <c>UPDATE</c> did not find, naming its entries.
    /// Its public constructors take EF's internal update entries, so the entries are given here instead.
    /// </summary>
    private sealed class RowGone(IReadOnlyList<EntityEntry> entries)
        : DbUpdateConcurrencyException("The row was deleted before the save.")
    {
        public override IReadOnlyList<EntityEntry> Entries => entries;
    }

    /// <summary>Fails every save with something that is not a row gone missing.</summary>
    private sealed class FailEverySave : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default) =>
            throw new DbUpdateException("The database refused the write.");
    }

    // ---------------------------------------------------------------- a move of several games

    [Fact]
    public async Task SetStatusesAsync_GamesFromSeveralLists_AreEachMovedWithAnEventOfTheirOwn()
    {
        // ADR 0018: a bulk move is N transitions and N events, each from where its own game was.
        using var db = NewDb();
        await AddEntryAsync(db, UserId, 10, ListStatusKeys.Backlog);
        await AddEntryAsync(db, UserId, 20, ListStatusKeys.Playing);
        await AddEntryAsync(db, UserId, 30, ListStatusKeys.OnHold);

        var results = await NewService(db).SetStatusesAsync(UserId, [10, 20, 30], ListStatusKeys.Finished);

        Assert.All(results, r => Assert.Equal(StatusChangeOutcomes.Moved, r.Outcome));

        var finished = StatusId(db, ListStatusKeys.Finished);
        Assert.All(await db.UserGameEntries.ToListAsync(), e =>
        {
            Assert.Equal(finished, e.StatusId);
            Assert.Equal(Midday, e.StatusChangedAt);
        });

        var events = await db.UserGameEvents.OrderBy(e => e.GameId).ToListAsync();
        Assert.Equal([10, 20, 30], events.Select(e => e.GameId));
        Assert.Equal(
            [StatusId(db, ListStatusKeys.Backlog), StatusId(db, ListStatusKeys.Playing), StatusId(db, ListStatusKeys.OnHold)],
            events.Select(e => e.FromStatusId!.Value));
        Assert.All(events, e =>
        {
            Assert.Equal(UserId, e.UserId);
            Assert.Equal(finished, e.ToStatusId);
            Assert.Equal(Midday, e.OccurredAt);
        });
    }

    [Fact]
    public async Task SetStatusesAsync_AGameAlreadyInTheList_IsUnchangedAndRecordsNothing()
    {
        // ADR 0018: a move to the status a game already holds records nothing — in a batch as on its own.
        using var db = NewDb();
        await AddEntryAsync(db, UserId, 10, ListStatusKeys.Backlog);
        await AddEntryAsync(db, UserId, 20, ListStatusKeys.Finished);

        var results = await NewService(db).SetStatusesAsync(UserId, [10, 20], ListStatusKeys.Finished);

        Assert.Equal(StatusChangeOutcomes.Moved, Outcomes(results)[10]);
        Assert.Equal(StatusChangeOutcomes.Unchanged, Outcomes(results)[20]);
        Assert.Equal(10, Assert.Single(await db.UserGameEvents.ToListAsync()).GameId);

        // Not moved, so not stamped as moved either.
        Assert.Equal(LastMonth, (await db.UserGameEntries.SingleAsync(e => e.GameId == 20)).StatusChangedAt);
    }

    [Fact]
    public async Task SetStatusesAsync_EveryGameAlreadyThere_SavesNoEventAtAll()
    {
        using var db = NewDb();
        await AddEntryAsync(db, UserId, 10, ListStatusKeys.Playing);
        await AddEntryAsync(db, UserId, 20, ListStatusKeys.Playing);

        var results = await NewService(db).SetStatusesAsync(UserId, [10, 20], ListStatusKeys.Playing);

        Assert.All(results, r => Assert.Equal(StatusChangeOutcomes.Unchanged, r.Outcome));
        Assert.Empty(await db.UserGameEvents.ToListAsync());
    }

    [Fact]
    public async Task SetStatusesAsync_WithANullStatus_TakesEachOutOfEveryList_AndKeepsTheRestOfTheEntry()
    {
        // ADR 0019: leaving every list clears the status and keeps the row, its score and its ownership.
        using var db = NewDb();
        await AddEntryAsync(db, UserId, 10, ListStatusKeys.Backlog, score: 8, ownership: OwnershipKinds.Owned);
        await AddEntryAsync(db, UserId, 20, ListStatusKeys.Playing);

        var results = await NewService(db).SetStatusesAsync(UserId, [10, 20], status: null);

        Assert.All(results, r => Assert.Equal(StatusChangeOutcomes.Moved, r.Outcome));

        var entries = await db.UserGameEntries.OrderBy(e => e.GameId).ToListAsync();
        Assert.Equal(2, entries.Count);
        Assert.All(entries, e => Assert.Null(e.StatusId));
        Assert.Equal((short)8, entries[0].Score);
        Assert.Equal(OwnershipKinds.Owned, entries[0].Ownership);

        var events = await db.UserGameEvents.ToListAsync();
        Assert.Equal(2, events.Count);
        Assert.All(events, e => Assert.Null(e.ToStatusId));
    }

    [Fact]
    public async Task SetStatusesAsync_RemovingAGameInNoList_IsUnchanged_WhetherOrNotThereIsAnEntry()
    {
        // In no list is what a removal asks for, and both of these already are.
        using var db = NewDb();
        await AddEntryAsync(db, UserId, 10, status: null, score: 6);

        var results = await NewService(db).SetStatusesAsync(UserId, [10, 20], status: null);

        Assert.Equal(StatusChangeOutcomes.Unchanged, Outcomes(results)[10]);
        Assert.Equal(StatusChangeOutcomes.Unchanged, Outcomes(results)[20]);
        Assert.Empty(await db.UserGameEvents.ToListAsync());
        Assert.Equal(10, Assert.Single(await db.UserGameEntries.ToListAsync()).GameId);
    }

    [Fact]
    public async Task SetStatusesAsync_MovingAGameThereIsNoEntryFor_IsMissing_AndCreatesNothing()
    {
        // Deleted from another tab since this one loaded. A single move would create the entry again;
        // the batch acts on the user's own games, and says so rather than bringing it back.
        using var db = NewDb();
        await AddEntryAsync(db, UserId, 10, ListStatusKeys.Backlog);

        var results = await NewService(db).SetStatusesAsync(UserId, [10, 20], ListStatusKeys.Playing);

        Assert.Equal(StatusChangeOutcomes.Moved, Outcomes(results)[10]);
        Assert.Equal(StatusChangeOutcomes.Missing, Outcomes(results)[20]);
        Assert.Equal(10, Assert.Single(await db.UserGameEntries.ToListAsync()).GameId);
        Assert.Equal(10, Assert.Single(await db.UserGameEvents.ToListAsync()).GameId);
    }

    [Fact]
    public async Task SetStatusesAsync_AnotherUsersGame_IsNeverReached()
    {
        // The scope is the read's own predicate: an id that is somebody else's entry is, to this user, a
        // game with no entry, whichever way it is asked.
        using var db = NewDb();
        await AddEntryAsync(db, OtherUserId, 10, ListStatusKeys.Backlog, position: 1024);

        var service = NewService(db);
        var moved = await service.SetStatusesAsync(UserId, [10], ListStatusKeys.Playing);
        var removed = await service.SetStatusesAsync(UserId, [10], status: null);

        Assert.Equal(StatusChangeOutcomes.Missing, Assert.Single(moved).Outcome);
        Assert.Equal(StatusChangeOutcomes.Unchanged, Assert.Single(removed).Outcome);

        var theirs = Assert.Single(await db.UserGameEntries.ToListAsync());
        Assert.Equal(OtherUserId, theirs.UserId);
        Assert.Equal(StatusId(db, ListStatusKeys.Backlog), theirs.StatusId);
        Assert.Equal(1024, theirs.Position);
        Assert.Equal(LastMonth, theirs.StatusChangedAt);
        Assert.Empty(await db.UserGameEvents.ToListAsync());
    }

    [Fact]
    public async Task SetStatusesAsync_AChangeOfList_ClearsThePosition_AndAGameLeftWhereItWasKeepsIt()
    {
        // ADR 0054: a place in the hand order is a place in the list the game is in now. Moved out, a game
        // loses it; one the batch found already in the target keeps the place it has there.
        using var db = NewDb();
        await AddEntryAsync(db, UserId, 10, ListStatusKeys.Backlog, position: 1024);
        await AddEntryAsync(db, UserId, 20, ListStatusKeys.Playing, position: 64);

        await NewService(db).SetStatusesAsync(UserId, [10, 20], ListStatusKeys.Playing);

        Assert.Null((await db.UserGameEntries.SingleAsync(e => e.GameId == 10)).Position);
        Assert.Equal(64, (await db.UserGameEntries.SingleAsync(e => e.GameId == 20)).Position);
    }

    [Fact]
    public async Task SetStatusesAsync_StampsOneMomentOnEveryChangeAndEveryEvent()
    {
        // One action, one moment: the games a batch brings into a list arrive together and are told
        // apart by title on the server, as the client's optimistic copy tells them apart.
        using var db = NewDb();
        await AddEntryAsync(db, UserId, 10, ListStatusKeys.Playing);
        await AddEntryAsync(db, UserId, 20, ListStatusKeys.Playing);
        await AddEntryAsync(db, UserId, 30, ListStatusKeys.Playing);

        await NewService(db, new TickingClock(Midday)).SetStatusesAsync(UserId, [10, 20, 30], ListStatusKeys.Backlog);

        Assert.Equal([Midday], (await db.UserGameEntries.ToListAsync()).Select(e => e.StatusChangedAt).Distinct());
        Assert.Equal([Midday], (await db.UserGameEvents.ToListAsync()).Select(e => e.OccurredAt).Distinct());
    }

    [Fact]
    public async Task SetStatusesAsync_AGameNamedTwice_IsMovedOnceAndAnsweredOnce()
    {
        using var db = NewDb();
        await AddEntryAsync(db, UserId, 10, ListStatusKeys.Backlog);
        await AddEntryAsync(db, UserId, 20, ListStatusKeys.Backlog);

        var results = await NewService(db).SetStatusesAsync(UserId, [10, 10, 20], ListStatusKeys.Playing);

        Assert.Equal([10, 20], results.Select(r => r.GameId));
        Assert.Equal(2, await db.UserGameEvents.CountAsync());
    }

    [Fact]
    public async Task SetStatusesAsync_AnswersEveryGameInTheOrderItWasFirstNamed()
    {
        using var db = NewDb();
        await AddEntryAsync(db, UserId, 10, ListStatusKeys.Finished);
        await AddEntryAsync(db, UserId, 30, ListStatusKeys.Backlog);

        var results = await NewService(db).SetStatusesAsync(UserId, [30, 20, 10], ListStatusKeys.Finished);

        Assert.Equal(
            [
                new StatusChangeDto(30, StatusChangeOutcomes.Moved),
                new StatusChangeDto(20, StatusChangeOutcomes.Missing),
                new StatusChangeDto(10, StatusChangeOutcomes.Unchanged),
            ],
            results);
    }

    [Theory]
    [InlineData("completed")]
    [InlineData("")]
    public async Task SetStatusesAsync_WithUnknownStatus_ThrowsAndWritesNothing(string status)
    {
        using var db = NewDb();
        await AddEntryAsync(db, UserId, 10, ListStatusKeys.Backlog);

        await Assert.ThrowsAsync<ArgumentException>(() => NewService(db).SetStatusesAsync(UserId, [10], status));

        Assert.Equal(StatusId(db, ListStatusKeys.Backlog), (await db.UserGameEntries.SingleAsync()).StatusId);
        Assert.Empty(await db.UserGameEvents.ToListAsync());
    }

    // ---------------------------------------------------------------- partial and total failure

    [Fact]
    public async Task SetStatusesAsync_ARowDeletedBeforeTheSave_IsAnsweredMissing_AndTheRestAreMovedWithTheirEvents()
    {
        // "Delete my data" for one of them, landing between the batch's read and its save. The save that
        // finds the row gone is rolled back whole; the retry saves the rest, and records nothing for the
        // game that was not moved — its event goes with it.
        var name = Guid.NewGuid().ToString();
        await using (var setup = NewDb(name))
        {
            foreach (var gameId in new[] { 10, 20, 30 }) await AddEntryAsync(setup, UserId, gameId, ListStatusKeys.Backlog);
        }

        var deleting = new DeleteBeforeSaves(name, 20);
        await using var db = NewDb(name, deleting);

        var results = await NewService(db).SetStatusesAsync(UserId, [10, 20, 30], ListStatusKeys.Playing);

        Assert.Equal(StatusChangeOutcomes.Moved, Outcomes(results)[10]);
        Assert.Equal(StatusChangeOutcomes.Missing, Outcomes(results)[20]);
        Assert.Equal(StatusChangeOutcomes.Moved, Outcomes(results)[30]);
        Assert.Equal(2, deleting.Saves);

        await using var check = NewDb(name);
        var playing = StatusId(check, ListStatusKeys.Playing);
        Assert.Equal([10, 30], (await check.UserGameEntries.OrderBy(e => e.GameId).ToListAsync()).Select(e => e.GameId));
        Assert.All(await check.UserGameEntries.ToListAsync(), e => Assert.Equal(playing, e.StatusId));
        Assert.Equal([10, 30], (await check.UserGameEvents.OrderBy(e => e.GameId).ToListAsync()).Select(e => e.GameId));
    }

    [Fact]
    public async Task SetStatusesAsync_ARowDeletedBeforeTheSaveOfARemoval_IsUnchanged_AndRecordsNoSecondDeparture()
    {
        // The delete recorded the game leaving its list itself; the removal must not record it again.
        var name = Guid.NewGuid().ToString();
        await using (var setup = NewDb(name))
        {
            await AddEntryAsync(setup, UserId, 10, ListStatusKeys.Backlog);
            await AddEntryAsync(setup, UserId, 20, ListStatusKeys.Backlog);
        }

        await using var db = NewDb(name, new DeleteBeforeSaves(name, 20));

        var results = await NewService(db).SetStatusesAsync(UserId, [10, 20], status: null);

        Assert.Equal(StatusChangeOutcomes.Moved, Outcomes(results)[10]);
        Assert.Equal(StatusChangeOutcomes.Unchanged, Outcomes(results)[20]);

        await using var check = NewDb(name);
        Assert.Equal(10, Assert.Single(await check.UserGameEvents.ToListAsync()).GameId);
    }

    [Fact]
    public async Task SetStatusesAsync_RowsDeletedBeforeEveryAttempt_GivesUpAfterTheThird_HavingSavedNothing()
    {
        // The retry is bounded so that a run of deletions ends in an error rather than a loop, and every
        // attempt was rolled back whole, so the game nobody deleted is where it was, with no event.
        var name = Guid.NewGuid().ToString();
        await using (var setup = NewDb(name))
        {
            foreach (var gameId in new[] { 10, 20, 30, 40 }) await AddEntryAsync(setup, UserId, gameId, ListStatusKeys.Backlog);
        }

        var deleting = new DeleteBeforeSaves(name, 10, 20, 30);
        await using var db = NewDb(name, deleting);

        await Assert.ThrowsAnyAsync<DbUpdateConcurrencyException>(
            () => NewService(db).SetStatusesAsync(UserId, [10, 20, 30, 40], ListStatusKeys.Playing));
        Assert.Equal(3, deleting.Saves);

        await using var check = NewDb(name);
        var left = Assert.Single(await check.UserGameEntries.ToListAsync());
        Assert.Equal(40, left.GameId);
        Assert.Equal(StatusId(check, ListStatusKeys.Backlog), left.StatusId);
        Assert.Empty(await check.UserGameEvents.ToListAsync());
    }

    [Fact]
    public async Task SetStatusesAsync_ASaveThatFails_MovesNothingAndRecordsNothing()
    {
        // One transaction: when it fails, no game has moved and no event says one did. Anything but a row
        // gone missing is not swallowed, so the client is told, and puts every game back.
        var name = Guid.NewGuid().ToString();
        await using (var setup = NewDb(name))
        {
            await AddEntryAsync(setup, UserId, 10, ListStatusKeys.Backlog);
            await AddEntryAsync(setup, UserId, 20, ListStatusKeys.Playing);
        }

        await using var db = NewDb(name, new FailEverySave());

        await Assert.ThrowsAsync<DbUpdateException>(
            () => NewService(db).SetStatusesAsync(UserId, [10, 20], ListStatusKeys.Finished));

        await using var check = NewDb(name);
        Assert.Equal(StatusId(check, ListStatusKeys.Backlog), (await check.UserGameEntries.SingleAsync(e => e.GameId == 10)).StatusId);
        Assert.Equal(StatusId(check, ListStatusKeys.Playing), (await check.UserGameEntries.SingleAsync(e => e.GameId == 20)).StatusId);
        Assert.Empty(await check.UserGameEvents.ToListAsync());
    }

    // ---------------------------------------------------------------- the single paths share the rule

    [Fact]
    public async Task SetListEntryAsync_AndRemoveListEntryAsync_StampTheEventAndTheChangeWithOneMoment()
    {
        // The single move and removal now go through the batch's rule, Transition; with a clock that
        // ticks on every read, two reads would put the event a second away from the change it records.
        using var db = NewDb();
        var service = NewService(db, new TickingClock(Midday));

        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Playing);
        var entry = await db.UserGameEntries.SingleAsync();
        var arrival = await db.UserGameEvents.SingleAsync();
        Assert.Equal(entry.StatusChangedAt, arrival.OccurredAt);

        await service.RemoveListEntryAsync(UserId, 10);
        var departure = await db.UserGameEvents.SingleAsync(e => e.ToStatusId == null);
        Assert.Equal((await db.UserGameEntries.SingleAsync()).StatusChangedAt, departure.OccurredAt);
    }

    // ---------------------------------------------------------------- what the API accepts

    /// <summary>
    /// The validation attributes on one of the DTO's properties — a property here, not a constructor
    /// parameter, because <c>required</c> cannot go on one (see <see cref="SetStatusesDto"/>).
    /// </summary>
    private static ValidationAttribute[] AttributesOf(string property) =>
        typeof(SetStatusesDto).GetProperty(property)!
            .GetCustomAttributes<ValidationAttribute>()
            .ToArray();

    private static bool Accepts(string property, object? value) =>
        AttributesOf(property).All(attribute => attribute.IsValid(value));

    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    [Fact]
    public void SetStatusesDto_Status_AcceptsExactlyTheSeededListsAndNull()
    {
        // Against the seeded statuses rather than a second copy of the keys, so a list added to one and
        // not the other fails here instead of as a 400 nobody can explain. Null is allowed by name:
        // without it in the list, AllowedValues refuses it.
        using var db = NewDb();
        var allowed = typeof(SetStatusesDto).GetProperty(nameof(SetStatusesDto.Status))!
            .GetCustomAttribute<AllowedValuesAttribute>()!.Values;

        Assert.Contains(null, allowed);
        Assert.Equal(db.ListStatuses.Select(s => s.Key).Order(), allowed.OfType<string>().Order());
        Assert.False(Accepts(nameof(SetStatusesDto.Status), "completed"));
    }

    [Fact]
    public void SetStatusesDto_GameIds_RefusesNoneAndMoreThanTheBound()
    {
        Assert.False(Accepts(nameof(SetStatusesDto.GameIds), null));
        Assert.False(Accepts(nameof(SetStatusesDto.GameIds), new List<int>()));
        Assert.True(Accepts(nameof(SetStatusesDto.GameIds), new List<int> { 10 }));
        Assert.True(Accepts(nameof(SetStatusesDto.GameIds), Enumerable.Range(1, ListBatch.MaxGames).ToList()));
        Assert.False(Accepts(nameof(SetStatusesDto.GameIds), Enumerable.Range(1, ListBatch.MaxGames + 1).ToList()));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    public void SetStatusesDto_AGameIdBelowOne_IsRefused(int gameId)
    {
        var dto = new SetStatusesDto { GameIds = [10, gameId], Status = ListStatusKeys.Playing };

        var error = Assert.Single(dto.Validate(new ValidationContext(dto)));

        Assert.Contains(nameof(SetStatusesDto.GameIds), error.MemberNames);
        Assert.Empty(new SetStatusesDto { GameIds = [10], Status = null }.Validate(new ValidationContext(dto)));
    }

    [Fact]
    public void SetStatusesDto_AStatusLeftOut_IsRefusedAsTheBodyIsRead_ButANullIsARemoval()
    {
        // A client that forgets the field must not take every game it named out of its list.
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<SetStatusesDto>("""{"gameIds":[10]}""", Web));

        var removal = JsonSerializer.Deserialize<SetStatusesDto>("""{"gameIds":[10],"status":null}""", Web)!;
        Assert.Null(removal.Status);
        Assert.Equal([10], removal.GameIds);
    }

    [Fact]
    public void SetStatusesDto_ANullAmongTheIds_IsRefusedAsTheBodyIsRead()
    {
        Assert.Throws<JsonException>(
            () => JsonSerializer.Deserialize<SetStatusesDto>("""{"gameIds":[10,null],"status":"playing"}""", Web));
    }

    [Fact]
    public void SetStatuses_HoldsTheBodyToItsLimitBeforeReadingIt()
    {
        var limit = typeof(ListsController).GetMethod(nameof(ListsController.SetStatuses))!
            .GetCustomAttribute<RequestSizeLimitAttribute>();

        Assert.NotNull(limit);
        Assert.Equal(ListBatch.MaxRequestBytes, ((IRequestSizeLimitMetadata)limit).MaxRequestBodySize);
    }
}
