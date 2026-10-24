using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// What a tag write does when another request changes what it read before it saves: a second tab, a
/// double press.
/// </summary>
/// <remarks>
/// <para>
/// The competing write has to land in one place — after the service has read and before it saves — or the
/// service's own check catches it and the test says nothing about the race guard. A
/// <c>SaveChangesInterceptor</c> puts it there, on options the test owns, as <c>WishlistRaceTests</c> does.
/// </para>
/// <para>
/// The in-memory provider enforces no unique index and no foreign key, so where PostgreSQL would refuse the
/// save — two spellings of one name, a link to a tag just deleted — the interceptor throws the
/// <see cref="DbUpdateException"/> EF would surface. A delete or an update of a row already gone is refused
/// by the provider itself, as a <see cref="DbUpdateConcurrencyException"/>. The guards confirm a race by
/// reading again rather than by matching an error code, so it is that reading again that is under test.
/// </para>
/// </remarks>
public class TagRaceTests
{
    private const string UserId = "user-1";
    private static readonly DateTimeOffset Midday = new(2026, 10, 17, 12, 0, 0, TimeSpan.Zero);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    /// <summary>Runs another request's write inside this context's saves — the first, or every one.</summary>
    private sealed class CommitsCompetingWrite(Func<Task> competingWrite, bool everySave = false) : SaveChangesInterceptor
    {
        private bool _fired;

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (everySave || !_fired)
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

    private static TagService NewService(ApplicationDbContext db) => new(db, new FixedClock(Midday));

    private static Tag NewTag(string name) =>
        new() { UserId = UserId, Name = name, NormalizedName = TagNamePolicy.Key(name), CreatedAt = Midday };

    private static int Seed(string store, Tag tag)
    {
        using var db = NewDb(store);
        db.Tags.Add(tag);
        db.SaveChanges();
        return tag.Id;
    }

    private static int SeedEntry(string store, int gameId)
    {
        using var db = NewDb(store);
        var entry = new UserGameEntry { UserId = UserId, GameId = gameId, AddedAt = Midday };
        db.UserGameEntries.Add(entry);
        db.SaveChanges();
        return entry.Id;
    }

    private static void SeedLink(string store, int entryId, int tagId)
    {
        using var db = NewDb(store);
        db.UserGameEntryTags.Add(new UserGameEntryTag
        {
            UserId = UserId, UserGameEntryId = entryId, TagId = tagId, AddedAt = Midday
        });
        db.SaveChanges();
    }

    // ---------------------------------------------------------------- create

    [Fact]
    public async Task CreateAsync_LosingTheInsertRace_AnswersWithTheWinnersTag()
    {
        // Another tab made "Co-op" between this request's check and its insert; PostgreSQL's unique index
        // refuses the second. The answer is the winner's tag, never a 500 and never a second row.
        var store = Guid.NewGuid().ToString();
        using var otherRequest = NewDb(store);

        using var db = NewDb(store, new CommitsCompetingWrite(async () =>
        {
            otherRequest.Tags.Add(NewTag("Co-op"));
            await otherRequest.SaveChangesAsync();
            throw new DbUpdateException("duplicate key value violates unique constraint \"IX_Tags_UserId_NormalizedName\"");
        }));

        var result = await NewService(db).CreateAsync(UserId, "CO-OP");

        Assert.False(result.Created);
        Assert.Equal("Co-op", result.Tag!.Name);
        Assert.Single(NewDb(store).Tags);
    }

    [Fact]
    public async Task CreateAsync_WhenTheSaveFailsForAnyOtherReason_StillThrows()
    {
        // The guard answers one race. A save that fails with no such tag there has to surface, or a real
        // fault would read as a tag made.
        var store = Guid.NewGuid().ToString();
        using var db = NewDb(store, new CommitsCompetingWrite(() => throw new DbUpdateException("disk on fire")));

        await Assert.ThrowsAsync<DbUpdateException>(() => NewService(db).CreateAsync(UserId, "Co-op"));
    }

    // ---------------------------------------------------------------- rename

    [Fact]
    public async Task RenameAsync_TagDeletedBeforeTheSave_IsNotFound()
    {
        var store = Guid.NewGuid().ToString();
        var tagId = Seed(store, NewTag("coop"));
        using var otherRequest = NewDb(store);

        using var db = NewDb(store, new CommitsCompetingWrite(async () =>
        {
            otherRequest.Tags.Remove(await otherRequest.Tags.SingleAsync());
            await otherRequest.SaveChangesAsync();
        }));

        var result = await NewService(db).RenameAsync(UserId, tagId, "Co-op");

        Assert.True(result.Missing);
    }

    [Fact]
    public async Task RenameAsync_NameTakenBeforeTheSave_IsRefusedWithTheWinnersSpelling()
    {
        var store = Guid.NewGuid().ToString();
        var tagId = Seed(store, NewTag("coop"));
        using var otherRequest = NewDb(store);

        using var db = NewDb(store, new CommitsCompetingWrite(async () =>
        {
            otherRequest.Tags.Add(NewTag("Co-op"));
            await otherRequest.SaveChangesAsync();
            throw new DbUpdateException("duplicate key value violates unique constraint \"IX_Tags_UserId_NormalizedName\"");
        }));

        var result = await NewService(db).RenameAsync(UserId, tagId, "CO-OP");

        Assert.Equal("You already have a tag called \"Co-op\".", result.Problem);
    }

    // ---------------------------------------------------------------- delete

    [Fact]
    public async Task DeleteAsync_ALinkTakenOffBeforeTheSave_StartsAgainAndDeletes()
    {
        // A set-write in another tab took the tag off one game after this read the tag's links: deleting
        // that link again finds nothing, the save is rolled back whole, and the delete reads again.
        var store = Guid.NewGuid().ToString();
        var tagId = Seed(store, NewTag("co-op"));
        var first = SeedEntry(store, 10);
        var second = SeedEntry(store, 11);
        SeedLink(store, first, tagId);
        SeedLink(store, second, tagId);
        using var otherRequest = NewDb(store);

        using var db = NewDb(store, new CommitsCompetingWrite(async () =>
        {
            otherRequest.UserGameEntryTags.Remove(
                await otherRequest.UserGameEntryTags.SingleAsync(l => l.UserGameEntryId == first));
            await otherRequest.SaveChangesAsync();
        }));

        Assert.True(await NewService(db).DeleteAsync(UserId, tagId));

        using var read = NewDb(store);
        Assert.Empty(read.Tags);
        Assert.Empty(read.UserGameEntryTags);
    }

    [Fact]
    public async Task DeleteAsync_TagDeletedBeforeTheSave_IsFalse()
    {
        // Pressed in two tabs: the other one's delete landed first.
        var store = Guid.NewGuid().ToString();
        var tagId = Seed(store, NewTag("co-op"));
        using var otherRequest = NewDb(store);

        using var db = NewDb(store, new CommitsCompetingWrite(async () =>
        {
            otherRequest.Tags.Remove(await otherRequest.Tags.SingleAsync());
            await otherRequest.SaveChangesAsync();
        }));

        Assert.False(await NewService(db).DeleteAsync(UserId, tagId));
    }

    // ---------------------------------------------------------------- one game's set

    [Fact]
    public async Task SetEntryTagsAsync_TagDeletedBeforeTheSave_IsRefusedRatherThanThrown()
    {
        // PostgreSQL's foreign key refuses the link to a tag deleted after the check. Read again, the tag
        // is not the caller's any more — the same 400 as a stale tab sending it in the first place.
        var store = Guid.NewGuid().ToString();
        var tagId = Seed(store, NewTag("co-op"));
        SeedEntry(store, 10);
        using var otherRequest = NewDb(store);

        using var db = NewDb(store, new CommitsCompetingWrite(async () =>
        {
            otherRequest.Tags.Remove(await otherRequest.Tags.SingleAsync());
            await otherRequest.SaveChangesAsync();
            throw new DbUpdateException("insert or update on table \"UserGameEntryTags\" violates foreign key constraint");
        }));

        var result = await NewService(db).SetEntryTagsAsync(UserId, 10, [tagId]);

        Assert.NotNull(result.Problem);
        Assert.Empty(NewDb(store).UserGameEntryTags);
    }

    [Fact]
    public async Task SetEntryTagsAsync_ALinkAddedBeforeTheSave_EndsWithExactlyTheSetAsked()
    {
        // Another tab put the same tag on the same game between the read and the save; the key on the pair
        // refuses the second insert. Read again, the link is there and nothing more is added.
        var store = Guid.NewGuid().ToString();
        var coop = Seed(store, NewTag("co-op"));
        var brief = Seed(store, NewTag("short"));
        var entryId = SeedEntry(store, 10);
        using var otherRequest = NewDb(store);

        using var db = NewDb(store, new CommitsCompetingWrite(async () =>
        {
            otherRequest.UserGameEntryTags.Add(new UserGameEntryTag
            {
                UserId = UserId, UserGameEntryId = entryId, TagId = coop, AddedAt = Midday.AddMinutes(-1)
            });
            await otherRequest.SaveChangesAsync();
            throw new DbUpdateException("duplicate key value violates unique constraint \"PK_UserGameEntryTags\"");
        }));

        var result = await NewService(db).SetEntryTagsAsync(UserId, 10, [coop, brief]);

        Assert.Null(result.Problem);
        using var read = NewDb(store);
        Assert.Equal([coop, brief], read.UserGameEntryTags.Select(l => l.TagId).OrderBy(id => id).ToList());
        // The other tab's link stays as it was put on, rather than being written again.
        Assert.Equal(Midday.AddMinutes(-1), read.UserGameEntryTags.Single(l => l.TagId == coop).AddedAt);
    }

    [Fact]
    public async Task SetEntryTagsAsync_EverySaveFails_GivesUpAfterThreeAttemptsAndThrows()
    {
        // A bound on the retry, so a fault that is not a race ends in an error rather than a loop.
        var store = Guid.NewGuid().ToString();
        var tagId = Seed(store, NewTag("co-op"));
        SeedEntry(store, 10);
        var attempts = 0;

        using var db = NewDb(store, new CommitsCompetingWrite(() =>
        {
            attempts++;
            throw new DbUpdateException("disk on fire");
        }, everySave: true));

        await Assert.ThrowsAsync<DbUpdateException>(() => NewService(db).SetEntryTagsAsync(UserId, 10, [tagId]));
        Assert.Equal(3, attempts);
    }
}
