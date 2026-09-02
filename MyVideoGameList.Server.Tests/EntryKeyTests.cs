using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The shape of <see cref="UserGameEntry"/>'s key.
/// </summary>
/// <remarks>
/// <para>
/// The surrogate key exists so that playthroughs, reviews and tags can point at one column
/// instead of carrying <c>(UserId, GameId)</c> in their own key and in every join. Uniqueness
/// still has to be <c>(UserId, GameId)</c> — the surrogate key adds a column, it does not relax a
/// constraint — and losing that index would let one user hold two entries for the same game, each
/// with its own score, with no way to say which is real.
/// </para>
/// <para>
/// These assert the <em>model</em>, because the EF Core in-memory provider does not enforce unique
/// indexes at all: a duplicate insert succeeds there whatever the model says. The database-level
/// constraint is verified by reading the generated migration SQL, which is why the migration
/// carries a note telling the next person to do the same.
/// </para>
/// </remarks>
public class EntryKeyTests
{
    private const string UserId = "user-1";
    private static readonly DateTimeOffset Midday = new(2026, 3, 14, 12, 0, 0, TimeSpan.Zero);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private static ApplicationDbContext NewDb()
    {
        var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);
        db.Database.EnsureCreated();
        return db;
    }

    private static ListService NewService(ApplicationDbContext db) =>
        new(db, Substitute.For<IIgdbService>(), new FixedClock(Midday));

    [Fact]
    public void UserGameEntry_IsKeyedOnItsSurrogateIdAlone()
    {
        using var db = NewDb();

        var key = db.Model.FindEntityType(typeof(UserGameEntry))!.FindPrimaryKey()!;

        Assert.Equal([nameof(UserGameEntry.Id)], key.Properties.Select(p => p.Name));
    }

    [Fact]
    public void UserGameEntry_StillHoldsUserAndGameUnique()
    {
        using var db = NewDb();

        var indexes = db.Model.FindEntityType(typeof(UserGameEntry))!.GetIndexes();

        Assert.Contains(indexes, index =>
            index.IsUnique
            && index.Properties.Select(p => p.Name)
                .SequenceEqual([nameof(UserGameEntry.UserId), nameof(UserGameEntry.GameId)]));
    }

    [Fact]
    public async Task RepeatedOperationsOnOneGame_ReuseTheSameEntryRow()
    {
        // The application-level half of the uniqueness guarantee: every write path goes through
        // find-or-create, so two entries for one game are never produced in the first place.
        using var db = NewDb();
        var service = NewService(db);

        await service.SetScoreAsync(UserId, 42, 7);
        await service.SetListEntryAsync(UserId, 42, ListStatusKeys.Playing);
        await service.SetListEntryAsync(UserId, 42, ListStatusKeys.Finished);
        await service.SetScoreAsync(UserId, 42, 9);

        var entry = db.UserGameEntries.Single();
        Assert.Equal((short)9, entry.Score);
    }

    [Fact]
    public async Task EachEntry_GetsItsOwnId()
    {
        using var db = NewDb();
        var service = NewService(db);

        await service.SetScoreAsync(UserId, 42, 7);
        await service.SetScoreAsync(UserId, 43, 8);
        await service.SetScoreAsync("user-2", 42, 9);

        var ids = db.UserGameEntries.Select(e => e.Id).ToList();
        Assert.Equal(3, ids.Count);
        Assert.Equal(3, ids.Distinct().Count());
        Assert.DoesNotContain(0, ids);
    }

    [Fact]
    public async Task DeletingAnEntry_DoesNotRenumberTheOthers()
    {
        // Children will hold these ids. A key that shifted when a sibling was deleted would
        // silently reattach a playthrough to a different game.
        using var db = NewDb();
        var service = NewService(db);
        await service.SetScoreAsync(UserId, 42, 7);
        await service.SetScoreAsync(UserId, 43, 8);

        var keptId = db.UserGameEntries.Single(e => e.GameId == 43).Id;
        await service.DeleteEntryAsync(UserId, 42);

        Assert.Equal(keptId, db.UserGameEntries.Single().Id);
    }

    [Fact]
    public void UserWishlistItem_HasNoForeignKeyToTheEntry()
    {
        // The wishlist is an axis of its own: a wishlisted game usually has no entry at all, so a
        // foreign key would force one into existence just to record wanting the game.
        using var db = NewDb();

        var foreignKeys = db.Model.FindEntityType(typeof(UserWishlistItem))!.GetForeignKeys();

        Assert.DoesNotContain(foreignKeys, fk => fk.PrincipalEntityType.ClrType == typeof(UserGameEntry));
    }

    [Fact]
    public void UserWishlistItem_IsKeyedOnUserAndGame()
    {
        // The composite key is what makes wishlisting idempotent at the database level.
        using var db = NewDb();

        var key = db.Model.FindEntityType(typeof(UserWishlistItem))!.FindPrimaryKey()!;

        Assert.Equal(
            [nameof(UserWishlistItem.UserId), nameof(UserWishlistItem.GameId)],
            key.Properties.Select(p => p.Name));
    }
}
