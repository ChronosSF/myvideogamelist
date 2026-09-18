using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The wishlist's race tests, run against the favourites.
/// </summary>
/// <remarks>
/// Both axes write through <see cref="GameAxisStore"/>, so the guard itself is one piece of code.
/// These exist so that a favourites service which stopped going through it — and so lost the
/// guard — fails here rather than on a double-click. See <see cref="WishlistRaceTests"/> for why the
/// competing write has to land inside the save rather than before the call.
/// </remarks>
public class FavouriteRaceTests
{
    private const string UserId = "user-1";
    private static readonly DateTimeOffset Midday = new(2026, 9, 15, 12, 0, 0, TimeSpan.Zero);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    /// <summary>Runs another request's write once, inside the first SaveChanges of this context.</summary>
    private sealed class CommitsCompetingWrite(Func<Task> competingWrite) : SaveChangesInterceptor
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
                await competingWrite();
            }
            return result;
        }
    }

    private static ApplicationDbContext NewDb(string store, IInterceptor? interceptor = null)
    {
        var options = new DbContextOptionsBuilder<ApplicationDbContext>().UseInMemoryDatabase(store);
        if (interceptor is not null) options.AddInterceptors(interceptor);
        return new ApplicationDbContext(options.Options);
    }

    private static FavouriteService NewService(ApplicationDbContext db) =>
        new(db, Substitute.For<IIgdbService>(), new FixedClock(Midday));

    private static UserFavourite Favourite(int gameId, DateTimeOffset? addedAt = null) =>
        new() { UserId = UserId, GameId = gameId, AddedAt = addedAt ?? Midday };

    [Fact]
    public async Task AddAsync_LosingTheInsertRace_ReturnsTheWinnersTimeRatherThanThrowing()
    {
        // Raised by hand, as in WishlistRaceTests: the in-memory provider does not translate a
        // duplicate key into the DbUpdateException PostgreSQL's would become.
        var store = Guid.NewGuid().ToString();
        using var otherRequest = NewDb(store);
        var winnersTime = Midday.AddSeconds(-1);

        using var db = NewDb(store, new CommitsCompetingWrite(async () =>
        {
            otherRequest.UserFavourites.Add(Favourite(42, winnersTime));
            await otherRequest.SaveChangesAsync();
            throw new DbUpdateException("duplicate key value violates unique constraint");
        }));

        var addedAt = await NewService(db).AddAsync(UserId, 42);

        Assert.Equal(winnersTime, addedAt);
        Assert.Single(NewDb(store).UserFavourites.Where(f => f.GameId == 42));
    }

    [Fact]
    public async Task AddAsync_WhenTheSaveFailsForAnyOtherReason_StillThrows()
    {
        var store = Guid.NewGuid().ToString();

        using var db = NewDb(store, new CommitsCompetingWrite(() =>
            throw new DbUpdateException("disk on fire")));

        await Assert.ThrowsAsync<DbUpdateException>(() => NewService(db).AddAsync(UserId, 42));
    }

    [Fact]
    public async Task RemoveAsync_LosingTheDeleteRace_ReportsNothingToRemoveRatherThanThrowing()
    {
        var store = Guid.NewGuid().ToString();
        using (var seed = NewDb(store))
        {
            seed.UserFavourites.Add(Favourite(42));
            await seed.SaveChangesAsync();
        }

        using var otherRequest = NewDb(store);

        using var db = NewDb(store, new CommitsCompetingWrite(async () =>
        {
            var doomed = await otherRequest.UserFavourites
                .FirstAsync(f => f.UserId == UserId && f.GameId == 42);
            otherRequest.UserFavourites.Remove(doomed);
            await otherRequest.SaveChangesAsync();
        }));

        var removed = await NewService(db).RemoveAsync(UserId, 42);

        Assert.False(removed);
        Assert.Empty(NewDb(store).UserFavourites);
    }
}
