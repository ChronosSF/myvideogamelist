using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// What happens when two requests act on the same wishlist row at once.
/// </summary>
/// <remarks>
/// <para>
/// Both endpoints are advertised as idempotent — <c>PUT</c> succeeds whatever the current state,
/// and a <c>DELETE</c> of something absent reports absence. Neither promise survives a naive
/// read-then-write, and a double-click or two open tabs is enough to hit it. The failure mode is a
/// 500 on the primary interaction.
/// </para>
/// <para>
/// The interleaving is what needs reproducing, and it has to land in a specific place: <em>after</em>
/// the service has checked whether the row exists and <em>before</em> it saves. Committing the
/// competing write before the call instead is the trap — the service's own pre-check then catches
/// it, the test passes, and it says nothing about the race guard at all.
/// </para>
/// <para>
/// A <c>SaveChangesInterceptor</c> puts the competing write in exactly that window. It is
/// configured on the options the test owns, so nothing in the service exists for testing's sake.
/// </para>
/// </remarks>
public class WishlistRaceTests
{
    private const string UserId = "user-1";
    private static readonly DateTimeOffset Midday = new(2026, 3, 14, 12, 0, 0, TimeSpan.Zero);

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

    private static WishlistService NewService(ApplicationDbContext db) =>
        new(db, Substitute.For<IIgdbService>(), new FixedClock(Midday));

    private static UserWishlistItem Item(int gameId) =>
        new() { UserId = UserId, GameId = gameId, AddedAt = Midday };

    [Fact]
    public async Task AddAsync_LosingTheInsertRace_ReportsAlreadyPresentRatherThanThrowing()
    {
        // The competing row lands and the save then fails, which is the shape of the real race.
        //
        // The DbUpdateException is raised here rather than left to the duplicate key, because the
        // in-memory provider does not translate a duplicate primary key into one — it throws a
        // raw ArgumentException from its backing dictionary. EF Core surfaces a provider write
        // failure as DbUpdateException, and the guard deliberately confirms the race by
        // re-reading rather than by matching an error code, so it is that translation being
        // tested here and not any one provider's choice of exception.
        var store = Guid.NewGuid().ToString();
        using var otherRequest = NewDb(store);

        using var db = NewDb(store, new CommitsCompetingWrite(async () =>
        {
            otherRequest.UserWishlistItems.Add(Item(42));
            await otherRequest.SaveChangesAsync();
            throw new DbUpdateException("duplicate key value violates unique constraint");
        }));

        var added = await NewService(db).AddAsync(UserId, 42);

        Assert.False(added);
        Assert.Single(NewDb(store).UserWishlistItems.Where(w => w.GameId == 42));
    }

    [Fact]
    public async Task AddAsync_WhenTheSaveFailsForAnyOtherReason_StillThrows()
    {
        // The guard translates one specific race, not every write failure. A save that fails with
        // the row still absent has to surface, or a genuine fault reads as a successful no-op.
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
            seed.UserWishlistItems.Add(Item(42));
            await seed.SaveChangesAsync();
        }

        using var otherRequest = NewDb(store);

        using var db = NewDb(store, new CommitsCompetingWrite(async () =>
        {
            var doomed = await otherRequest.UserWishlistItems
                .FirstAsync(w => w.UserId == UserId && w.GameId == 42);
            otherRequest.UserWishlistItems.Remove(doomed);
            await otherRequest.SaveChangesAsync();
        }));

        // The service loads the row, and the competing delete commits before its own save.
        var removed = await NewService(db).RemoveAsync(UserId, 42);

        Assert.False(removed);
        Assert.Empty(NewDb(store).UserWishlistItems);
    }
}
