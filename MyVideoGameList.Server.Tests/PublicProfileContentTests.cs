using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// Which entries a public profile counts, and which profiles the sitemap lists — the same question,
/// asked of one game holding one thing at a time (#346).
/// </summary>
/// <remarks>
/// Each case is an account whose whole library is one entry holding exactly one kind of thing. The
/// public ones count on the profile and list it; the private ones do neither, while the owner's own
/// statistics still count every entry. The integration suite's <c>PublicFiguresFlowTests</c> asks the
/// same of PostgreSQL, through the API.
/// </remarks>
public class PublicProfileContentTests
{
    private const string UserId = "user-1";
    private const string PublicId = "b4kz9q2mxw7c";
    private const int GameId = 11;

    private static readonly DateTimeOffset Now = new(2026, 11, 22, 12, 0, 0, TimeSpan.Zero);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    /// <summary>What the one entry holds: something a public reader is shown.</summary>
    public static TheoryData<string> Shown => ["status", "score", "playthrough", "public review"];

    /// <summary>What the one entry holds: something its owner keeps to themselves.</summary>
    public static TheoryData<string> Private => ["notes", "ownership", "tag", "private review", "hidden review"];

    private static ApplicationDbContext NewDb()
    {
        var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);
        db.Database.EnsureCreated();
        return db;
    }

    private static StatsService Stats(ApplicationDbContext db) => new(db, new FixedClock(Now));

    private static PublicProfileService Profiles(ApplicationDbContext db) =>
        new(db, Stats(db), Substitute.For<IGameCacheService>());

    private static void AddAccount(ApplicationDbContext db, string visibility = ProfileVisibility.Public)
    {
        db.Users.Add(new ApplicationUser
        {
            Id = UserId,
            PublicId = PublicId,
            UserName = "alex",
            NormalizedUserName = "ALEX",
            Email = "alex@test.local",
            ProfileVisibility = visibility
        });
        db.SaveChanges();
    }

    /// <summary>One entry, holding exactly the thing named and nothing else.</summary>
    private static void AddEntryHolding(ApplicationDbContext db, string holding)
    {
        var entry = new UserGameEntry { UserId = UserId, GameId = GameId, AddedAt = Now };

        switch (holding)
        {
            case "status":
                entry.StatusId = db.ListStatuses.Single(s => s.Key == ListStatusKeys.Backlog).Id;
                break;
            case "score":
                entry.Score = 7;
                break;
            case "notes":
                entry.Notes = "Lent to Sam.";
                break;
            case "ownership":
                entry.Ownership = OwnershipKinds.Owned;
                break;
        }

        db.UserGameEntries.Add(entry);
        db.SaveChanges();

        switch (holding)
        {
            case "playthrough":
                db.UserGamePlaythroughs.Add(new UserGamePlaythrough
                {
                    UserId = UserId,
                    Entry = entry,
                    CreatedAt = Now,
                    UpdatedAt = Now
                });
                break;
            case "public review":
            case "private review":
            case "hidden review":
                db.Reviews.Add(new Review
                {
                    UserId = UserId,
                    Entry = entry,
                    Body = "Played it.",
                    Visibility = holding == "private review" ? ReviewVisibility.Private : ReviewVisibility.Public,
                    CreatedAt = Now,
                    UpdatedAt = Now,
                    HiddenAt = holding == "hidden review" ? Now : null
                });
                break;
            case "tag":
                var tag = new Tag { UserId = UserId, Name = "co-op", NormalizedName = "CO-OP", CreatedAt = Now };
                db.Tags.Add(tag);
                db.UserGameEntryTags.Add(new UserGameEntryTag
                {
                    UserId = UserId,
                    Entry = entry,
                    Tag = tag,
                    AddedAt = Now
                });
                break;
        }

        db.SaveChanges();
    }

    [Theory]
    [MemberData(nameof(Shown))]
    public async Task GetProfileAsync_AnEntryHoldingSomethingShown_IsCountedAndListsTheProfile(string holding)
    {
        using var db = NewDb();
        AddAccount(db);
        AddEntryHolding(db, holding);

        var profile = await Profiles(db).GetProfileAsync(PublicId);

        Assert.NotNull(profile);
        Assert.Equal(1, profile.Library.Recorded);
        Assert.True(profile.Listed);
    }

    /// <summary>
    /// The bug: a tag on a game its owner had said nothing else about moved a public number by one,
    /// and could put an otherwise empty profile in the sitemap and the index.
    /// </summary>
    [Theory]
    [MemberData(nameof(Private))]
    public async Task GetProfileAsync_AnEntryHoldingOnlySomethingPrivate_IsNotCountedAndListsNothing(string holding)
    {
        using var db = NewDb();
        AddAccount(db);
        AddEntryHolding(db, holding);

        var profile = await Profiles(db).GetProfileAsync(PublicId);

        Assert.NotNull(profile);
        Assert.Equal(0, profile.Library.Recorded);
        Assert.False(profile.Listed);
    }

    [Theory]
    [MemberData(nameof(Shown))]
    public async Task GetProfilesAsync_AnEntryHoldingSomethingShown_ListsTheProfile(string holding)
    {
        using var db = NewDb();
        AddAccount(db);
        AddEntryHolding(db, holding);

        var sitemap = new SitemapService(db);

        Assert.Equal([new(PublicId, "alex")], await sitemap.GetProfilesAsync(1));
        Assert.Equal(1, (await sitemap.GetSummaryAsync()).Profiles);
    }

    [Theory]
    [MemberData(nameof(Private))]
    public async Task GetProfilesAsync_AnEntryHoldingOnlySomethingPrivate_ListsNothing(string holding)
    {
        using var db = NewDb();
        AddAccount(db);
        AddEntryHolding(db, holding);

        var sitemap = new SitemapService(db);

        Assert.Empty(await sitemap.GetProfilesAsync(1));
        Assert.Equal(0, (await sitemap.GetSummaryAsync()).Profiles);
    }

    /// <summary>
    /// The owner's own page is about everything they recorded, the private parts included, and is
    /// read by nobody else.
    /// </summary>
    [Theory]
    [MemberData(nameof(Shown))]
    [MemberData(nameof(Private))]
    public async Task GetStatsAsync_AnyEntry_IsStillCountedOnTheOwnersOwnProfile(string holding)
    {
        using var db = NewDb();
        AddAccount(db);
        AddEntryHolding(db, holding);

        var stats = await Stats(db).GetStatsAsync(UserId, default);

        Assert.Equal(1, stats.Library.Recorded);
    }

    /// <summary>
    /// The page marks itself <c>noindex</c> from <c>Listed</c>, and a sitemap listing a page marked
    /// <c>noindex</c> is an error in every search console, so the two answers are one.
    /// </summary>
    [Theory]
    [MemberData(nameof(Shown))]
    [MemberData(nameof(Private))]
    public async Task GetProfileAsync_Listed_IsWhetherTheSitemapListsTheProfile(string holding)
    {
        using var db = NewDb();
        AddAccount(db);
        AddEntryHolding(db, holding);

        var profile = await Profiles(db).GetProfileAsync(PublicId);
        var listed = await new SitemapService(db).GetProfilesAsync(1);

        Assert.NotNull(profile);
        Assert.Equal(listed.Any(p => p.PublicId == PublicId), profile.Listed);
    }

    /// <summary>
    /// A favourite needs no entry (ADR 0029), and is the one thing on its axis made to be shown, so a
    /// shelf of them is something on the page however private the rest of the library is.
    /// </summary>
    [Fact]
    public async Task GetProfileAsync_AFavouriteBesideOnlyPrivateEntries_ListsTheProfile()
    {
        using var db = NewDb();
        AddAccount(db);
        AddEntryHolding(db, "tag");
        db.UserFavourites.Add(new UserFavourite { UserId = UserId, GameId = 12, AddedAt = Now });
        db.SaveChanges();

        var profile = await Profiles(db).GetProfileAsync(PublicId);

        Assert.NotNull(profile);
        Assert.Equal(0, profile.Library.Recorded);
        Assert.True(profile.Listed);
        Assert.Single(await new SitemapService(db).GetProfilesAsync(1));
    }

    /// <summary>
    /// The wishlist's size is all a profile shows of it, which is not enough to be worth indexing —
    /// as before, and unchanged by what an entry may count.
    /// </summary>
    [Fact]
    public async Task GetProfileAsync_AWishlistAlone_ListsNothing()
    {
        using var db = NewDb();
        AddAccount(db);
        db.UserWishlistItems.Add(new UserWishlistItem { UserId = UserId, GameId = 12, AddedAt = Now });
        db.SaveChanges();

        var profile = await Profiles(db).GetProfileAsync(PublicId);

        Assert.NotNull(profile);
        Assert.Equal(1, profile.Library.Wishlisted);
        Assert.False(profile.Listed);
        Assert.Empty(await new SitemapService(db).GetProfilesAsync(1));
    }

    /// <summary>
    /// Another account's playthrough or published review of the same game counts towards nobody's
    /// entry but its own: a run and a review are keyed to their entry, never to the game.
    /// </summary>
    [Fact]
    public async Task GetProfileAsync_SomebodyElsesRunAndReviewOfTheSameGame_DoNotCountTowardsThisEntry()
    {
        using var db = NewDb();
        AddAccount(db);
        AddEntryHolding(db, "notes");

        db.Users.Add(new ApplicationUser
        {
            Id = "user-2",
            PublicId = "7tn3vjh8p0sd",
            UserName = "sam",
            NormalizedUserName = "SAM",
            Email = "sam@test.local"
        });
        var theirs = new UserGameEntry { UserId = "user-2", GameId = GameId, AddedAt = Now };
        db.UserGameEntries.Add(theirs);
        db.UserGamePlaythroughs.Add(new UserGamePlaythrough
        {
            UserId = "user-2",
            Entry = theirs,
            CreatedAt = Now,
            UpdatedAt = Now
        });
        db.Reviews.Add(new Review
        {
            UserId = "user-2",
            Entry = theirs,
            Body = "Theirs.",
            Visibility = ReviewVisibility.Public,
            CreatedAt = Now,
            UpdatedAt = Now
        });
        db.SaveChanges();

        var profile = await Profiles(db).GetProfileAsync(PublicId);

        Assert.NotNull(profile);
        Assert.Equal(0, profile.Library.Recorded);
        Assert.False(profile.Listed);
    }
}
