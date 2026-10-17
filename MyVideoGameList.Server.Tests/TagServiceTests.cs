using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// A user's tags: one of each name per account whatever its case, a cap on how many, a rename that keeps
/// every game, a delete that takes the tag off every game, and a write of one game's whole set that
/// replaces it — never touching another account's entry or tag. See ADR 0065.
/// </summary>
/// <remarks>
/// Every test opens a fresh context on the same in-memory store to read back what the service wrote,
/// so a result cannot be an artefact of what the service's own context happened to be tracking. The
/// unique index, the composite foreign keys and the cascades are PostgreSQL's to enforce and the
/// in-memory provider enforces none of them, which is why <see cref="TagModelTests"/> asserts the model
/// and the migration's SQL was read.
/// </remarks>
public class TagServiceTests
{
    private const string UserId = "user-1";
    private const string OtherUserId = "user-2";

    private static readonly DateTimeOffset Midday = new(2026, 10, 17, 12, 0, 0, TimeSpan.Zero);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan by) => _now = _now.Add(by);
    }

    /// <summary>One in-memory database, opened as many times as a test likes.</summary>
    private sealed class Store
    {
        private readonly DbContextOptions<ApplicationDbContext> _options =
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options;

        public ApplicationDbContext Open()
        {
            var db = new ApplicationDbContext(_options);
            db.Database.EnsureCreated();
            return db;
        }
    }

    private static TagService NewService(ApplicationDbContext db, TimeProvider? clock = null) =>
        new(db, clock ?? new FixedClock(Midday));

    private static int AddEntry(Store store, int gameId, string? status = null, string userId = UserId)
    {
        using var db = store.Open();
        var entry = new UserGameEntry
        {
            UserId = userId,
            GameId = gameId,
            StatusId = status is null ? null : db.ListStatuses.Single(s => s.Key == status).Id,
            AddedAt = Midday.AddDays(-30)
        };
        db.UserGameEntries.Add(entry);
        db.SaveChanges();
        return entry.Id;
    }

    private static int AddTag(Store store, string name, string userId = UserId)
    {
        using var db = store.Open();
        var tag = new Tag
        {
            UserId = userId,
            Name = name,
            NormalizedName = TagNamePolicy.Key(name),
            CreatedAt = Midday.AddDays(-10)
        };
        db.Tags.Add(tag);
        db.SaveChanges();
        return tag.Id;
    }

    private static void Link(Store store, int entryId, int tagId, DateTimeOffset? at = null, string userId = UserId)
    {
        using var db = store.Open();
        db.UserGameEntryTags.Add(new UserGameEntryTag
        {
            UserId = userId,
            UserGameEntryId = entryId,
            TagId = tagId,
            AddedAt = at ?? Midday.AddDays(-5)
        });
        db.SaveChanges();
    }

    /// <summary>The tag ids on one account's entry for a game, read fresh, in id order.</summary>
    private static List<int> TagsOn(Store store, int gameId, string userId = UserId)
    {
        using var db = store.Open();
        return db.UserGameEntryTags
            .Where(l => l.UserId == userId && l.Entry.GameId == gameId)
            .Select(l => l.TagId)
            .OrderBy(id => id)
            .ToList();
    }

    // ---------------------------------------------------------------- reading

    [Fact]
    public async Task GetTagsAsync_ReturnsOnlyTheAccountsOwnTags_InNameOrder_WithHowManyGamesCarryEach()
    {
        var store = new Store();
        var brief = AddTag(store, "short");
        var coop = AddTag(store, "Co-op");
        AddTag(store, "theirs", userId: OtherUserId);

        var hades = AddEntry(store, 10, ListStatusKeys.Playing);
        var celeste = AddEntry(store, 11, ListStatusKeys.Finished);
        Link(store, hades, coop);
        Link(store, celeste, coop);
        Link(store, celeste, brief);

        using var db = store.Open();
        var tags = await NewService(db).GetTagsAsync(UserId);

        Assert.Equal(
            [("Co-op", 2), ("short", 1)],
            tags.Select(t => (t.Name, t.Count)));
    }

    [Fact]
    public async Task GetTagsAsync_CountsAGameThatIsInNoList()
    {
        // A game taken out of every list keeps its entry and so its tags (ADR 0019), and the count says
        // how many games carry the tag — not how many of them are in a list.
        var store = new Store();
        var tag = AddTag(store, "replay");
        Link(store, AddEntry(store, 10, status: null), tag);

        using var db = store.Open();
        var counted = Assert.Single(await NewService(db).GetTagsAsync(UserId));

        Assert.Equal(1, counted.Count);
    }

    [Fact]
    public async Task GetTagsAsync_ATagNoGameCarries_IsListedWithACountOfNone()
    {
        var store = new Store();
        AddTag(store, "someday");

        using var db = store.Open();

        Assert.Equal(0, Assert.Single(await NewService(db).GetTagsAsync(UserId)).Count);
    }

    // ---------------------------------------------------------------- creating

    [Fact]
    public async Task CreateAsync_StoresTheNameTidied_AndFoldedForTheIndex()
    {
        var store = new Store();
        using var db = store.Open();

        var result = await NewService(db).CreateAsync(UserId, "  couch \t co-op  ");

        Assert.True(result.Created);
        Assert.Equal("couch co-op", result.Tag!.Name);
        Assert.Equal(0, result.Tag.Count);

        using var read = store.Open();
        var stored = Assert.Single(read.Tags);
        Assert.Equal(UserId, stored.UserId);
        Assert.Equal("couch co-op", stored.Name);
        Assert.Equal("COUCH CO-OP", stored.NormalizedName);
        Assert.Equal(Midday, stored.CreatedAt);
    }

    [Fact]
    public async Task CreateAsync_ANameTheAccountHasInAnotherCase_IsThatTagRatherThanASecondOne()
    {
        // The whole point of the folded column: "Co-op" and "CO-OP" are one tag. A create of a name the
        // account already has answers with it, which is what a tab with an out-of-date list sends.
        var store = new Store();
        var existing = AddTag(store, "Co-op");

        using var db = store.Open();
        var result = await NewService(db).CreateAsync(UserId, "CO-OP");

        Assert.False(result.Created);
        Assert.Equal(existing, result.Tag!.Id);
        Assert.Equal("Co-op", result.Tag.Name);

        using var read = store.Open();
        Assert.Single(read.Tags);
    }

    [Fact]
    public async Task CreateAsync_AComposedAndADecomposedSpelling_AreOneTag()
    {
        // "é" as one character and as "e" with a combining accent are two strings and one word.
        var store = new Store();
        using var db = store.Open();
        var service = NewService(db);

        var composed = await service.CreateAsync(UserId, "café");
        var decomposed = await service.CreateAsync(UserId, "café");

        Assert.Equal(composed.Tag!.Id, decomposed.Tag!.Id);
        Assert.False(decomposed.Created);
    }

    [Fact]
    public async Task CreateAsync_TheSameNameOnAnotherAccount_IsATagOfItsOwn()
    {
        // Per account, not a global vocabulary: two people's "short" know nothing of each other.
        var store = new Store();
        var theirs = AddTag(store, "short", userId: OtherUserId);

        using var db = store.Open();
        var result = await NewService(db).CreateAsync(UserId, "short");

        Assert.True(result.Created);
        Assert.NotEqual(theirs, result.Tag!.Id);

        using var read = store.Open();
        Assert.Equal(2, read.Tags.Count(t => t.Name == "short"));
    }

    [Fact]
    public async Task CreateAsync_AtTheAccountsCap_IsRefusedAndStoresNothing()
    {
        var store = new Store();
        using (var seed = store.Open())
        {
            for (var i = 0; i < TagNamePolicy.MaxTagsPerAccount; i++)
                seed.Tags.Add(new Tag { UserId = UserId, Name = $"tag {i}", NormalizedName = $"TAG {i}", CreatedAt = Midday });
            seed.SaveChanges();
        }

        using var db = store.Open();
        var result = await NewService(db).CreateAsync(UserId, "one too many");

        Assert.Null(result.Tag);
        Assert.Contains($"{TagNamePolicy.MaxTagsPerAccount} tags", result.Problem);

        using var read = store.Open();
        Assert.Equal(TagNamePolicy.MaxTagsPerAccount, read.Tags.Count(t => t.UserId == UserId));
    }

    [Fact]
    public async Task CreateAsync_AtTheCap_StillAnswersWithATagTheAccountHas()
    {
        // The cap is on making tags, not on naming one that exists: an account at the limit picking "co-op"
        // again from a stale list is not refused.
        var store = new Store();
        using (var seed = store.Open())
        {
            for (var i = 0; i < TagNamePolicy.MaxTagsPerAccount; i++)
                seed.Tags.Add(new Tag { UserId = UserId, Name = $"tag {i}", NormalizedName = $"TAG {i}", CreatedAt = Midday });
            seed.SaveChanges();
        }

        using var db = store.Open();
        var result = await NewService(db).CreateAsync(UserId, "TAG 7");

        Assert.Null(result.Problem);
        Assert.Equal("tag 7", result.Tag!.Name);
    }

    [Fact]
    public async Task CreateAsync_AnotherAccountAtItsCap_DoesNotCountAgainstThisOne()
    {
        var store = new Store();
        using (var seed = store.Open())
        {
            for (var i = 0; i < TagNamePolicy.MaxTagsPerAccount; i++)
                seed.Tags.Add(new Tag { UserId = OtherUserId, Name = $"tag {i}", NormalizedName = $"TAG {i}", CreatedAt = Midday });
            seed.SaveChanges();
        }

        using var db = store.Open();

        Assert.True((await NewService(db).CreateAsync(UserId, "mine")).Created);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("this tag is far too long to fit on a chip")]
    [InlineData("bell\u0007")]
    public async Task CreateAsync_ANameThePolicyRefuses_IsRefusedAndStoresNothing(string name)
    {
        // The DTO's attribute refuses these first; the service refuses them again for any other caller.
        var store = new Store();
        using var db = store.Open();

        var result = await NewService(db).CreateAsync(UserId, name);

        Assert.NotNull(result.Problem);
        Assert.Null(result.Tag);

        using var read = store.Open();
        Assert.Empty(read.Tags);
    }

    // ---------------------------------------------------------------- renaming

    [Fact]
    public async Task RenameAsync_KeepsEveryGameTheTagIsOn()
    {
        var store = new Store();
        var tag = AddTag(store, "coop");
        Link(store, AddEntry(store, 10, ListStatusKeys.Playing), tag);
        Link(store, AddEntry(store, 11, ListStatusKeys.Backlog), tag);

        using var db = store.Open();
        var result = await NewService(db).RenameAsync(UserId, tag, " Co-op ");

        Assert.Equal(new TagDto(tag, "Co-op", 2), result.Tag);

        using var read = store.Open();
        var renamed = read.Tags.Single();
        Assert.Equal("Co-op", renamed.Name);
        Assert.Equal("CO-OP", renamed.NormalizedName);
        Assert.Equal([tag], TagsOn(store, 10));
        Assert.Equal([tag], TagsOn(store, 11));
    }

    [Fact]
    public async Task RenameAsync_ToItsOwnNameInAnotherCase_IsARename()
    {
        var store = new Store();
        var tag = AddTag(store, "coop");

        using var db = store.Open();
        var result = await NewService(db).RenameAsync(UserId, tag, "COOP");

        Assert.Equal("COOP", result.Tag!.Name);
    }

    [Fact]
    public async Task RenameAsync_ToAnotherTagsName_IsRefusedAndChangesNeither()
    {
        // Refused rather than merged: folding two tags into one is a different act from renaming one.
        var store = new Store();
        var coop = AddTag(store, "co-op");
        var couch = AddTag(store, "couch");

        using var db = store.Open();
        var result = await NewService(db).RenameAsync(UserId, couch, "CO-OP");

        Assert.Equal("You already have a tag called \"co-op\".", result.Problem);

        using var read = store.Open();
        Assert.Equal("co-op", read.Tags.Single(t => t.Id == coop).Name);
        Assert.Equal("couch", read.Tags.Single(t => t.Id == couch).Name);
    }

    [Fact]
    public async Task RenameAsync_ToAnotherAccountsTagsName_IsARename()
    {
        var store = new Store();
        AddTag(store, "co-op", userId: OtherUserId);
        var mine = AddTag(store, "coop");

        using var db = store.Open();

        Assert.Equal("co-op", (await NewService(db).RenameAsync(UserId, mine, "co-op")).Tag!.Name);
    }

    [Fact]
    public async Task RenameAsync_AnotherAccountsTag_IsNotFoundAndKeepsItsName()
    {
        var store = new Store();
        var theirs = AddTag(store, "theirs", userId: OtherUserId);

        using var db = store.Open();
        var result = await NewService(db).RenameAsync(UserId, theirs, "mine now");

        Assert.True(result.Missing);

        using var read = store.Open();
        Assert.Equal("theirs", read.Tags.Single().Name);
    }

    [Fact]
    public async Task RenameAsync_ANameThePolicyRefuses_IsRefusedAndChangesNothing()
    {
        var store = new Store();
        var tag = AddTag(store, "short");

        using var db = store.Open();
        var result = await NewService(db).RenameAsync(UserId, tag, "   ");

        Assert.Equal("A tag needs a name.", result.Problem);

        using var read = store.Open();
        Assert.Equal("short", read.Tags.Single().Name);
    }

    // ---------------------------------------------------------------- deleting

    [Fact]
    public async Task DeleteAsync_TakesTheTagOffEveryGame()
    {
        // Seeded through other contexts, so nothing here is tracked by the one the service uses: a delete
        // that relied on the in-memory provider cascading what it happens to be tracking would leave
        // the links behind and fail.
        var store = new Store();
        var tag = AddTag(store, "co-op");
        Link(store, AddEntry(store, 10, ListStatusKeys.Playing), tag);
        Link(store, AddEntry(store, 11, status: null), tag);

        using var db = store.Open();
        Assert.True(await NewService(db).DeleteAsync(UserId, tag));

        using var read = store.Open();
        Assert.Empty(read.Tags);
        Assert.Empty(read.UserGameEntryTags);
    }

    [Fact]
    public async Task DeleteAsync_LeavesTheGamesAndTheirOtherTags()
    {
        var store = new Store();
        var gone = AddTag(store, "co-op");
        var kept = AddTag(store, "short");
        var entry = AddEntry(store, 10, ListStatusKeys.Playing);
        Link(store, entry, gone);
        Link(store, entry, kept);

        using var db = store.Open();
        await NewService(db).DeleteAsync(UserId, gone);

        using var read = store.Open();
        Assert.Single(read.UserGameEntries);
        Assert.Equal([kept], TagsOn(store, 10));
    }

    [Fact]
    public async Task DeleteAsync_AnotherAccountsTag_IsNotFoundAndKeepsItAndItsGames()
    {
        var store = new Store();
        var theirs = AddTag(store, "theirs", userId: OtherUserId);
        Link(store, AddEntry(store, 10, ListStatusKeys.Playing, userId: OtherUserId), theirs, userId: OtherUserId);

        using var db = store.Open();
        Assert.False(await NewService(db).DeleteAsync(UserId, theirs));

        using var read = store.Open();
        Assert.Single(read.Tags);
        Assert.Equal([theirs], TagsOn(store, 10, userId: OtherUserId));
    }

    [Fact]
    public async Task DeleteAsync_ATagThatIsNotThere_IsFalse()
    {
        var store = new Store();
        using var db = store.Open();

        Assert.False(await NewService(db).DeleteAsync(UserId, 999));
    }

    // ---------------------------------------------------------------- one game's set

    [Fact]
    public async Task SetEntryTagsAsync_ReplacesTheWholeSet()
    {
        var store = new Store();
        var a = AddTag(store, "a");
        var b = AddTag(store, "b");
        var c = AddTag(store, "c");
        var entry = AddEntry(store, 10, ListStatusKeys.Playing);
        Link(store, entry, a);
        Link(store, entry, b);

        using var db = store.Open();
        var result = await NewService(db).SetEntryTagsAsync(UserId, 10, [b, c]);

        Assert.Null(result.Problem);
        Assert.Equal([b, c], TagsOn(store, 10));
    }

    [Fact]
    public async Task SetEntryTagsAsync_ATagThatStays_KeepsWhenItWasPutOn()
    {
        // A diff rather than a delete and a re-insert: the moment a tag went on is the link's history.
        var store = new Store();
        var kept = AddTag(store, "kept");
        var added = AddTag(store, "added");
        var entry = AddEntry(store, 10, ListStatusKeys.Playing);
        var then = Midday.AddDays(-3);
        Link(store, entry, kept, at: then);

        using var db = store.Open();
        await NewService(db).SetEntryTagsAsync(UserId, 10, [kept, added]);

        using var read = store.Open();
        Assert.Equal(then, read.UserGameEntryTags.Single(l => l.TagId == kept).AddedAt);
        Assert.Equal(Midday, read.UserGameEntryTags.Single(l => l.TagId == added).AddedAt);
    }

    [Fact]
    public async Task SetEntryTagsAsync_ATagNamedTwice_IsCarriedOnce()
    {
        var store = new Store();
        var tag = AddTag(store, "co-op");
        AddEntry(store, 10, ListStatusKeys.Playing);

        using var db = store.Open();
        var result = await NewService(db).SetEntryTagsAsync(UserId, 10, [tag, tag]);

        Assert.Null(result.Problem);
        Assert.Equal([tag], TagsOn(store, 10));
    }

    [Fact]
    public async Task SetEntryTagsAsync_AnEmptySet_TakesEveryTagOffAndKeepsTheEntry()
    {
        var store = new Store();
        var entry = AddEntry(store, 10, ListStatusKeys.Finished);
        Link(store, entry, AddTag(store, "a"));
        Link(store, entry, AddTag(store, "b"));

        using var db = store.Open();
        await NewService(db).SetEntryTagsAsync(UserId, 10, []);

        Assert.Empty(TagsOn(store, 10));

        using var read = store.Open();
        Assert.Single(read.UserGameEntries);
        // The tags themselves are the account's, not the game's: taking them off a game deletes none.
        Assert.Equal(2, read.Tags.Count());
    }

    [Fact]
    public async Task SetEntryTagsAsync_OnAGameWithNoEntry_CreatesOneInNoList()
    {
        // Tagging a game the user has never listed is legitimate, as scoring one is (ADR 0019).
        var store = new Store();
        var tag = AddTag(store, "someday");

        using var db = store.Open();
        await NewService(db).SetEntryTagsAsync(UserId, 10, [tag]);

        using var read = store.Open();
        var entry = Assert.Single(read.UserGameEntries);
        Assert.Equal(10, entry.GameId);
        Assert.Null(entry.StatusId);
        Assert.Equal(Midday, entry.AddedAt);
        Assert.Equal([tag], TagsOn(store, 10));
    }

    [Fact]
    public async Task SetEntryTagsAsync_AnEmptySetOnAGameWithNoEntry_CreatesNothing()
    {
        // A row holding nothing would switch on the game page's "delete my data" for a game the user has
        // said nothing about (ADR 0030 §5).
        var store = new Store();
        using var db = store.Open();

        var result = await NewService(db).SetEntryTagsAsync(UserId, 10, []);

        Assert.Null(result.Problem);

        using var read = store.Open();
        Assert.Empty(read.UserGameEntries);
    }

    [Fact]
    public async Task SetEntryTagsAsync_AnotherAccountsTag_IsRefusedAndWritesNothing()
    {
        // The composite foreign key would refuse the link in PostgreSQL; the service refuses it first, as
        // a sentence, and writes none of the set — not even the tags that were the caller's own.
        var store = new Store();
        var mine = AddTag(store, "mine");
        var theirs = AddTag(store, "theirs", userId: OtherUserId);
        AddEntry(store, 10, ListStatusKeys.Playing);

        using var db = store.Open();
        var result = await NewService(db).SetEntryTagsAsync(UserId, 10, [mine, theirs]);

        Assert.NotNull(result.Problem);
        Assert.Empty(TagsOn(store, 10));
    }

    [Fact]
    public async Task SetEntryTagsAsync_ATagThatDoesNotExist_IsRefusedAndCreatesNoEntry()
    {
        // Deleted in another tab, say. Refused before the entry is found or made, so a refusal leaves no
        // row behind.
        var store = new Store();
        using var db = store.Open();

        var result = await NewService(db).SetEntryTagsAsync(UserId, 10, [999]);

        Assert.NotNull(result.Problem);

        using var read = store.Open();
        Assert.Empty(read.UserGameEntries);
    }

    [Fact]
    public async Task SetEntryTagsAsync_OverTheCap_IsRefused()
    {
        var store = new Store();
        var ids = Enumerable.Range(0, TagNamePolicy.MaxTagsPerEntry + 1)
            .Select(i => AddTag(store, $"tag {i}"))
            .ToList();
        AddEntry(store, 10, ListStatusKeys.Playing);

        using var db = store.Open();
        var result = await NewService(db).SetEntryTagsAsync(UserId, 10, ids);

        Assert.Equal($"A game can carry at most {TagNamePolicy.MaxTagsPerEntry} tags.", result.Problem);
        Assert.Empty(TagsOn(store, 10));
    }

    [Fact]
    public async Task SetEntryTagsAsync_AtTheCap_IsStored()
    {
        var store = new Store();
        var ids = Enumerable.Range(0, TagNamePolicy.MaxTagsPerEntry)
            .Select(i => AddTag(store, $"tag {i}"))
            .ToList();

        using var db = store.Open();
        var result = await NewService(db).SetEntryTagsAsync(UserId, 10, ids);

        Assert.Null(result.Problem);
        Assert.Equal(TagNamePolicy.MaxTagsPerEntry, TagsOn(store, 10).Count);
    }

    [Fact]
    public async Task SetEntryTagsAsync_NeverTouchesAnotherAccountsEntryForTheSameGame()
    {
        // The entry is found by the caller's own id in the predicate, never by the game alone — that
        // scoping is the authorization boundary. Somebody else tracking the same game has their own entry,
        // and the caller tagging it makes one of the caller's own.
        var store = new Store();
        var theirTag = AddTag(store, "theirs", userId: OtherUserId);
        var theirEntry = AddEntry(store, 10, ListStatusKeys.Playing, userId: OtherUserId);
        Link(store, theirEntry, theirTag, userId: OtherUserId);
        var mine = AddTag(store, "mine");

        using var db = store.Open();
        await NewService(db).SetEntryTagsAsync(UserId, 10, [mine]);
        await NewService(db).SetEntryTagsAsync(UserId, 10, []);

        Assert.Equal([theirTag], TagsOn(store, 10, userId: OtherUserId));

        using var read = store.Open();
        Assert.Equal(2, read.UserGameEntries.Count(e => e.GameId == 10));
    }

    [Fact]
    public async Task SetEntryTagsAsync_RecordsNoEventAndMovesNothing()
    {
        // A tag is not a status (ADR 0018): nothing here appends to the log or writes StatusId.
        var store = new Store();
        var tag = AddTag(store, "co-op");
        AddEntry(store, 10, ListStatusKeys.OnHold);

        using var db = store.Open();
        var service = NewService(db);
        await service.SetEntryTagsAsync(UserId, 10, [tag]);
        await service.SetEntryTagsAsync(UserId, 11, [tag]);
        await service.SetEntryTagsAsync(UserId, 10, []);

        using var read = store.Open();
        Assert.Empty(read.UserGameEvents);
        var onHold = read.ListStatuses.Single(s => s.Key == ListStatusKeys.OnHold).Id;
        Assert.Equal(onHold, read.UserGameEntries.Single(e => e.GameId == 10).StatusId);
        Assert.Null(read.UserGameEntries.Single(e => e.GameId == 11).StatusId);
    }

    [Fact]
    public async Task EveryWrite_RecordsNoEvent()
    {
        var store = new Store();
        using var db = store.Open();
        var service = NewService(db);

        var created = await service.CreateAsync(UserId, "co-op");
        await service.SetEntryTagsAsync(UserId, 10, [created.Tag!.Id]);
        await service.RenameAsync(UserId, created.Tag.Id, "Co-op");
        await service.DeleteAsync(UserId, created.Tag.Id);

        using var read = store.Open();
        Assert.Empty(read.UserGameEvents);
    }

    // ---------------------------------------------------------------- what the lists carry

    private static GameDto Game(int id) =>
        new(id, $"Game {id}", null, null, null, null, null, null, null, null, null, null, null,
            Platforms: [], Genres: [], Developers: [], Publishers: [], Details: null);

    private static ListService NewListService(ApplicationDbContext db, params int[] gameIds)
    {
        var cache = Substitute.For<IGameCacheService>();
        cache.GetGamesAsync(Arg.Any<IEnumerable<int>>(), Arg.Any<CancellationToken>())
            .Returns(gameIds.Select(Game).ToList());
        return new ListService(db, cache, new FixedClock(Midday));
    }

    [Fact]
    public async Task GetListsAsync_EachRowCarriesItsOwnTagIds()
    {
        var store = new Store();
        var a = AddTag(store, "a");
        var b = AddTag(store, "b");
        var hades = AddEntry(store, 10, ListStatusKeys.Playing);
        AddEntry(store, 11, ListStatusKeys.Playing);
        Link(store, hades, b);
        Link(store, hades, a);

        // Somebody else's tags on somebody else's entry for the same game must not reach this account's row.
        var theirs = AddTag(store, "theirs", userId: OtherUserId);
        Link(store, AddEntry(store, 10, ListStatusKeys.Playing, userId: OtherUserId), theirs, userId: OtherUserId);

        using var db = store.Open();
        var playing = (await NewListService(db, 10, 11).GetListsAsync(UserId)).Lists[ListStatusKeys.Playing];

        Assert.Equal([a, b], playing.Single(e => e.Game.Id == 10).TagIds);
        Assert.Empty(playing.Single(e => e.Game.Id == 11).TagIds);
    }

    [Fact]
    public async Task GetEntryAsync_CarriesTheEntrysTagIds()
    {
        var store = new Store();
        var tag = AddTag(store, "replay");
        Link(store, AddEntry(store, 10, status: null), tag);

        using var db = store.Open();
        var entry = await NewListService(db, 10).GetEntryAsync(UserId, 10);

        Assert.Equal([tag], entry!.Entry.TagIds);
    }
}
