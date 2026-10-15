using System.ComponentModel.DataAnnotations;
using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using MyVideoGameList.Server.Controllers;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The write behind a hand-arranged order, and the bounds the API holds the client's numbers to.
/// The list-level rules — scoped to the list, cleared by a move — are in <c>ListServiceTests</c>.
/// </summary>
public class HandOrderTests
{
    private const string UserId = "user-1";
    private const string OtherUserId = "user-2";

    private static readonly DateTimeOffset Midday = new(2026, 3, 14, 12, 0, 0, TimeSpan.Zero);

    private static DbContextOptions<ApplicationDbContext> Options(string name, params IInterceptor[] interceptors) =>
        new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(name)
            .AddInterceptors(interceptors)
            .Options;

    private static async Task AddEntryAsync(ApplicationDbContext db, string userId, int gameId, int? position = null)
    {
        db.UserGameEntries.Add(new UserGameEntry
        {
            UserId = userId, GameId = gameId, AddedAt = Midday, Position = position
        });
        await db.SaveChangesAsync();
    }

    /// <summary>
    /// Deletes one game's row through a second context the first time the context it is attached to
    /// saves — which is the moment a request that read the row is about to write it.
    /// </summary>
    private sealed class DeleteBeforeFirstSave(string databaseName, int gameId) : SaveChangesInterceptor
    {
        private bool _fired;

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (!_fired)
            {
                _fired = true;
                await using var other = new ApplicationDbContext(Options(databaseName));
                other.UserGameEntries.RemoveRange(other.UserGameEntries.Where(e => e.GameId == gameId));
                await other.SaveChangesAsync(cancellationToken);
            }

            return result;
        }
    }

    // ---------------------------------------------------------------- the store

    [Fact]
    public async Task WriteAsync_ARowDeletedBeforeTheSave_IsPassedOverAndTheRestAreWritten()
    {
        // "Delete my data" for one game landing between this write's read and its save. Without the
        // retry the whole move would fail as a 500 over a game that is no longer in the list.
        var name = Guid.NewGuid().ToString();
        await using (var setup = new ApplicationDbContext(Options(name)))
        {
            await AddEntryAsync(setup, UserId, 10);
            await AddEntryAsync(setup, UserId, 20);
        }

        await using var db = new ApplicationDbContext(Options(name, new DeleteBeforeFirstSave(name, 10)));

        var written = await HandOrderStore.WriteAsync(
            db, db.UserGameEntries, UserId, [new PositionDto(10, 1024), new PositionDto(20, 2048)],
            CancellationToken.None);

        Assert.Equal(1, written);

        await using var check = new ApplicationDbContext(Options(name));
        var left = Assert.Single(await check.UserGameEntries.ToListAsync());
        Assert.Equal(20, left.GameId);
        Assert.Equal(2048, left.Position);
    }

    [Fact]
    public async Task WriteAsync_ScopesToTheUserWhateverTheListPassed()
    {
        // The list a caller passes is narrowed by its own predicate, and one that forgot the user in
        // it must still not reach another account's rows.
        await using var db = new ApplicationDbContext(Options(Guid.NewGuid().ToString()));
        await AddEntryAsync(db, UserId, 10);
        await AddEntryAsync(db, OtherUserId, 10, position: 4096);

        var written = await HandOrderStore.WriteAsync(
            db, db.UserGameEntries, UserId, [new PositionDto(10, 1024)], CancellationToken.None);

        Assert.Equal(1, written);
        Assert.Equal(1024, (await db.UserGameEntries.AsNoTracking().SingleAsync(e => e.UserId == UserId)).Position);
        Assert.Equal(4096, (await db.UserGameEntries.AsNoTracking().SingleAsync(e => e.UserId == OtherUserId)).Position);
    }

    // ---------------------------------------------------------------- the list's setup

    /// <summary>
    /// <c>EnsureCreated</c> is what applies the <c>ListStatuses</c> seed on the in-memory provider.
    /// Without it every status lookup misses and the service throws.
    /// </summary>
    private static ApplicationDbContext NewDb()
    {
        var db = new ApplicationDbContext(Options(Guid.NewGuid().ToString()));
        db.Database.EnsureCreated();
        return db;
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private static GameDto Game(int id) =>
        new(id, "Game", null, null, null, null, null, null, null, null, null, null, null,
            Platforms: [], Genres: [], Developers: [], Publishers: [], Details: null);

    private static IGameCacheService IgdbReturning(params GameDto[] games)
    {
        var igdb = Substitute.For<IGameCacheService>();
        igdb.GetGamesAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>()).Returns(games);
        return igdb;
    }

    private static ListService NewService(ApplicationDbContext db, IGameCacheService? igdb = null) =>
        new(db, igdb ?? Substitute.For<IGameCacheService>(), new FixedClock(Midday));

    private static short StatusId(ApplicationDbContext db, string key) =>
        db.ListStatuses.Single(s => s.Key == key).Id;

    // ---------------------------------------------------------------- the list

    /// <summary>A game already in the user's backlog, at a position or none.</summary>
    private static async Task<UserGameEntry> InBacklogAsync(
        ApplicationDbContext db, int gameId, int? position = null, string userId = UserId)
    {
        var entry = new UserGameEntry
        {
            UserId = userId,
            GameId = gameId,
            StatusId = StatusId(db, ListStatusKeys.Backlog),
            AddedAt = Midday,
            StatusChangedAt = Midday,
            Position = position
        };
        db.UserGameEntries.Add(entry);
        await db.SaveChangesAsync();
        return entry;
    }

    private static Task<int?> PositionOfAsync(ApplicationDbContext db, int gameId, string userId = UserId) =>
        db.UserGameEntries
            .AsNoTracking()
            .Where(e => e.UserId == userId && e.GameId == gameId)
            .Select(e => e.Position)
            .SingleAsync();

    [Fact]
    public async Task SetPositionsAsync_PlacesTheGamesItNamesAndNoOthers()
    {
        // The point of a sparse position: one game moves and one row is written. Every game the
        // write does not name keeps the number it had, placed or not.
        using var db = NewDb();
        await InBacklogAsync(db, 10, position: 1024);
        await InBacklogAsync(db, 20, position: 2048);
        await InBacklogAsync(db, 30);
        var service = NewService(db);

        await service.SetPositionsAsync(UserId, ListStatusKeys.Backlog, [new PositionDto(20, 512)]);

        Assert.Equal(1024, await PositionOfAsync(db, 10));
        Assert.Equal(512, await PositionOfAsync(db, 20));
        Assert.Null(await PositionOfAsync(db, 30));
    }

    [Fact]
    public async Task SetPositionsAsync_AGameNamedTwice_TakesTheLastOfItsPositions()
    {
        using var db = NewDb();
        await InBacklogAsync(db, 10);
        var service = NewService(db);

        await service.SetPositionsAsync(
            UserId, ListStatusKeys.Backlog, [new PositionDto(10, 1024), new PositionDto(10, -1024)]);

        Assert.Equal(-1024, await PositionOfAsync(db, 10));
    }

    [Fact]
    public async Task SetPositionsAsync_PassesOverAGameThatIsNotInTheList()
    {
        // A tab that loaded the backlog before the game moved to Playing still names it. Its place in
        // the backlog went with it, so the write must not give a Playing game a backlog position.
        using var db = NewDb();
        await InBacklogAsync(db, 10);
        var service = NewService(db);
        await service.SetListEntryAsync(UserId, 20, ListStatusKeys.Playing);

        await service.SetPositionsAsync(
            UserId, ListStatusKeys.Backlog, [new PositionDto(10, 1024), new PositionDto(20, 2048)]);

        Assert.Equal(1024, await PositionOfAsync(db, 10));
        Assert.Null(await PositionOfAsync(db, 20));
    }

    [Fact]
    public async Task SetPositionsAsync_NeverWritesAnotherUsersEntry()
    {
        // The same game in somebody else's backlog. The user is in the predicate, not taken on trust
        // from anything the request says.
        using var db = NewDb();
        await InBacklogAsync(db, 10, position: 4096, userId: "someone-else");
        await InBacklogAsync(db, 10);
        var service = NewService(db);

        await service.SetPositionsAsync(UserId, ListStatusKeys.Backlog, [new PositionDto(10, 1024)]);

        Assert.Equal(1024, await PositionOfAsync(db, 10));
        Assert.Equal(4096, await PositionOfAsync(db, 10, "someone-else"));
    }

    [Fact]
    public async Task SetPositionsAsync_ForAGameNeverRecorded_CreatesNoEntry()
    {
        // A game in a list already has an entry, so a position for one that has none is a game that
        // is in no list at all — and that is passed over like any other.
        using var db = NewDb();
        var service = NewService(db);

        await service.SetPositionsAsync(UserId, ListStatusKeys.Backlog, [new PositionDto(10, 1024)]);

        Assert.Empty(await db.UserGameEntries.ToListAsync());
    }

    [Fact]
    public async Task SetPositionsAsync_RecordsNoEvent()
    {
        using var db = NewDb();
        await InBacklogAsync(db, 10);
        var service = NewService(db);

        await service.SetPositionsAsync(UserId, ListStatusKeys.Backlog, [new PositionDto(10, 1024)]);

        Assert.Empty(await db.UserGameEvents.ToListAsync());
    }

    [Theory]
    [InlineData("wishlist")]
    [InlineData("Backlog")]
    public async Task SetPositionsAsync_WithUnknownStatus_Throws(string status)
    {
        using var db = NewDb();
        var service = NewService(db);

        await Assert.ThrowsAsync<ArgumentException>(
            () => service.SetPositionsAsync(UserId, status, [new PositionDto(10, 1024)]));
    }

    [Fact]
    public async Task SetListEntryAsync_ToAnotherList_ClearsThePosition()
    {
        // A number chosen between two backlog neighbours means nothing in Playing, and a game that
        // comes back arrives at the end of the backlog like any other arrival.
        using var db = NewDb();
        await InBacklogAsync(db, 10, position: 1024);
        var service = NewService(db);

        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Playing);
        Assert.Null(await PositionOfAsync(db, 10));

        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Backlog);
        Assert.Null(await PositionOfAsync(db, 10));
    }

    [Fact]
    public async Task SetListEntryAsync_ToTheListItIsIn_KeepsThePosition()
    {
        // Not a move, so not a reason to lose a place — and the client sends these.
        using var db = NewDb();
        await InBacklogAsync(db, 10, position: 1024);
        var service = NewService(db);

        await service.SetListEntryAsync(UserId, 10, ListStatusKeys.Backlog);

        Assert.Equal(1024, await PositionOfAsync(db, 10));
    }

    [Fact]
    public async Task RemoveListEntryAsync_ClearsThePosition()
    {
        using var db = NewDb();
        await InBacklogAsync(db, 10, position: 1024);
        var service = NewService(db);

        await service.RemoveListEntryAsync(UserId, 10);

        Assert.Null(await PositionOfAsync(db, 10));
    }

    [Fact]
    public async Task TheEntrysOwnFields_LeaveThePositionWhereItWas()
    {
        // A score, an ownership and a note write the same row as a position, and none of them is a
        // reason for the game to lose its place.
        using var db = NewDb();
        await InBacklogAsync(db, 10, position: 1024);
        var service = NewService(db);

        await service.SetScoreAsync(UserId, 10, 7);
        await service.SetOwnershipAsync(UserId, 10, OwnershipKinds.Owned);
        await service.SetNotesAsync(UserId, 10, "Start on hard.");

        Assert.Equal(1024, await PositionOfAsync(db, 10));
    }

    [Fact]
    public async Task TheListPayload_CarriesThePositionAndNullForAGameNeverPlaced()
    {
        using var db = NewDb();
        await InBacklogAsync(db, 10, position: 1024);
        await InBacklogAsync(db, 20);
        var service = NewService(db, IgdbReturning(Game(10), Game(20)));

        var backlog = (await service.GetListsAsync(UserId)).Lists[ListStatusKeys.Backlog];

        Assert.Equal(1024, backlog.Single(e => e.Game.Id == 10).Position);
        Assert.Null(backlog.Single(e => e.Game.Id == 20).Position);
    }

    // ---------------------------------------------------------------- what the API accepts

    /// <summary>
    /// The validation attributes on a record's constructor parameter, which is where MVC reads them
    /// and where <c>Validator.TryValidateObject</c> — which reads properties — would not look.
    /// </summary>
    private static ValidationAttribute[] AttributesOf<TDto>(string parameter) =>
        typeof(TDto).GetConstructors().Single().GetParameters()
            .Single(p => p.Name == parameter)
            .GetCustomAttributes<ValidationAttribute>()
            .ToArray();

    private static bool Accepts<TDto>(string parameter, object? value) =>
        AttributesOf<TDto>(parameter).All(attribute => attribute.IsValid(value));

    [Theory]
    [InlineData(HandOrder.MinPosition)]
    [InlineData(0)]
    [InlineData(HandOrder.MaxPosition)]
    public void PositionDto_AcceptsEveryPositionInTheRange(int position) =>
        Assert.True(Accepts<PositionDto>("Position", position));

    [Theory]
    [InlineData(HandOrder.MinPosition - 1)]
    [InlineData(HandOrder.MaxPosition + 1)]
    [InlineData(int.MaxValue)]
    public void PositionDto_RefusesAPositionOutsideTheRange(int position) =>
        Assert.False(Accepts<PositionDto>("Position", position));

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void PositionDto_RefusesAGameIdThatIsNotOne(int gameId) =>
        Assert.False(Accepts<PositionDto>("GameId", gameId));

    [Fact]
    public void SetPositionsDto_RefusesAnEmptyWriteAndOneLongerThanTheBound()
    {
        Assert.False(Accepts<SetPositionsDto>("Positions", new List<PositionDto>()));
        Assert.True(Accepts<SetPositionsDto>("Positions", new List<PositionDto> { new(10, 0) }));

        var tooMany = Enumerable.Range(1, HandOrder.MaxWrites + 1).Select(id => new PositionDto(id, id)).ToList();
        Assert.False(Accepts<SetPositionsDto>("Positions", tooMany));
    }

    [Fact]
    public void TheSortPreference_AcceptsEverySortKey()
    {
        // The keys are written down twice, the constants and the DTO's attribute, and the manual
        // order was the first key added since: a constant the attribute does not list is a choice
        // the client offers and the server refuses to remember, silently, on every click.
        var keys = typeof(ListSortKeys)
            .GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(f => f.IsLiteral)
            .Select(f => (string)f.GetRawConstantValue()!)
            .ToList();

        Assert.Contains(ListSortKeys.Manual, keys);
        foreach (var key in keys) Assert.True(Accepts<ListSortPreferenceDto>("SortKey", key), key);
    }

    [Fact]
    public void ThePositionsRoute_AcceptsExactlyTheListsThatAreSeeded()
    {
        // Against the seeded statuses rather than a second copy of the keys, so a list added to one
        // and not the other fails here instead of as a 400 nobody can explain.
        using var db = new ApplicationDbContext(Options(Guid.NewGuid().ToString()));
        db.Database.EnsureCreated();

        var status = typeof(ListsController).GetMethod(nameof(ListsController.SetPositions))!
            .GetParameters().Single(p => p.Name == "status");
        var allowed = status.GetCustomAttribute<AllowedValuesAttribute>()!.Values;

        Assert.Equal(db.ListStatuses.Select(s => s.Key).Order(), allowed.OfType<string>().Order());
    }
}
