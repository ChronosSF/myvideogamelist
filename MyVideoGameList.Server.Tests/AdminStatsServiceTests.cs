using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// What the admin page counts (ADR 0051): which rows fall in which figure, which days in which window
/// and which moments in which week.
/// </summary>
public class AdminStatsServiceTests
{
    /// <summary>A Tuesday, so the week began the day before.</summary>
    private static readonly DateTimeOffset Now = new(2026, 10, 13, 12, 0, 0, TimeSpan.Zero);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    /// <summary>The real statuses, from the context's own seed, as <c>StatsServiceTests</c> has them.</summary>
    private static ApplicationDbContext NewDb()
    {
        var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);
        db.Database.EnsureCreated();
        return db;
    }

    private static AdminStatsService NewService(ApplicationDbContext db) => new(db, new FixedClock(Now));

    private static DateTimeOffset At(int month, int day, int hour = 12, int minute = 0, double offsetHours = 0) =>
        new(2026, month, day, hour, minute, 0, TimeSpan.FromHours(offsetHours));

    private static void AddAccount(
        ApplicationDbContext db,
        string id,
        DateTimeOffset? createdAt = null,
        DateTimeOffset? lastSeenAt = null,
        string profileVisibility = ProfileVisibility.Private)
    {
        db.Users.Add(new ApplicationUser
        {
            Id = id,
            UserName = id,
            Email = $"{id}@test.local",
            CreatedAt = createdAt,
            LastSeenAt = lastSeenAt,
            ProfileVisibility = profileVisibility,
        });
        db.SaveChanges();
    }

    private static UserGameEntry AddEntry(
        ApplicationDbContext db,
        int gameId,
        string? status,
        string origin = EntryOrigins.Manual,
        string userId = "a")
    {
        var entry = new UserGameEntry
        {
            UserId = userId,
            GameId = gameId,
            StatusId = status is null ? null : db.ListStatuses.Single(s => s.Key == status).Id,
            Origin = origin,
            AddedAt = Now,
        };
        db.UserGameEntries.Add(entry);
        db.SaveChanges();
        return entry;
    }

    private static void AddPlaythrough(ApplicationDbContext db, UserGameEntry entry, DateTimeOffset createdAt, int? minutesPlayed = null)
    {
        db.UserGamePlaythroughs.Add(new UserGamePlaythrough
        {
            UserId = entry.UserId,
            UserGameEntryId = entry.Id,
            MinutesPlayed = minutesPlayed,
            CreatedAt = createdAt,
            UpdatedAt = createdAt,
        });
        db.SaveChanges();
    }

    private static void AddReview(ApplicationDbContext db, UserGameEntry entry, DateTimeOffset createdAt, string visibility = ReviewVisibility.Private)
    {
        db.Reviews.Add(new Review
        {
            UserId = entry.UserId,
            UserGameEntryId = entry.Id,
            Body = "Fine.",
            Visibility = visibility,
            CreatedAt = createdAt,
            UpdatedAt = createdAt,
        });
        db.SaveChanges();
    }

    [Fact]
    public async Task GetAsync_CountsAccounts_SeenInWholeUtcDays()
    {
        using var db = NewDb();
        AddAccount(db, "today", At(9, 1), lastSeenAt: At(10, 13, 0, 30), profileVisibility: ProfileVisibility.Public);
        AddAccount(db, "six-days-ago", At(9, 1), lastSeenAt: At(10, 7, 23));
        AddAccount(db, "seven-days-ago", At(9, 1), lastSeenAt: At(10, 6, 12));
        AddAccount(db, "thirty-days-ago", At(9, 1), lastSeenAt: At(9, 13, 23, 59));
        AddAccount(db, "before-records");

        var accounts = (await NewService(db).GetAsync(CancellationToken.None)).Accounts;

        Assert.Equal(5, accounts.Total);
        Assert.Equal(1, accounts.PublicProfiles);
        Assert.Equal(1, accounts.SeenToday);
        // Today and the six days before it reach back to 7 October; the 6th is the eighth day.
        Assert.Equal(2, accounts.SeenInSevenDays);
        // Today and the twenty-nine before it reach back to 14 September, whatever the hour on the 13th.
        Assert.Equal(3, accounts.SeenInThirtyDays);
        Assert.Equal(1, accounts.Undated);
    }

    [Fact]
    public async Task GetAsync_CountsTheLibrary_EveryListNamedInTheListsOrder()
    {
        using var db = NewDb();
        AddAccount(db, "a");
        AddEntry(db, 1, ListStatusKeys.Backlog);
        AddEntry(db, 2, ListStatusKeys.Backlog);
        AddEntry(db, 3, ListStatusKeys.Finished);
        AddEntry(db, 4, ListStatusKeys.Playing, origin: EntryOrigins.Grouvee);
        AddEntry(db, 5, status: null);
        db.UserWishlistItems.AddRange(
            new UserWishlistItem { UserId = "a", GameId = 6, AddedAt = Now },
            new UserWishlistItem { UserId = "a", GameId = 7, AddedAt = Now });
        db.UserFavourites.Add(new UserFavourite { UserId = "a", GameId = 3, AddedAt = Now });
        db.SaveChanges();

        var library = (await NewService(db).GetAsync(CancellationToken.None)).Library;

        // An empty list is named with a nought, so the page shows every list whether used or not.
        Assert.Equal(
            new[] { ListStatusKeys.Backlog, ListStatusKeys.Playing, ListStatusKeys.OnHold, ListStatusKeys.Finished, ListStatusKeys.Dropped },
            library.ByStatus.Keys);
        Assert.Equal(new[] { 2, 1, 0, 1, 0 }, library.ByStatus.Values);
        Assert.Equal(1, library.InNoList);
        Assert.Equal(1, library.FromImports);
        Assert.Equal(2, library.Wishlisted);
        Assert.Equal(1, library.Favourites);
    }

    [Fact]
    public async Task GetAsync_CountsWhatMembersWrite_AndTheImportsTheSweepStillHolds()
    {
        using var db = NewDb();
        AddAccount(db, "a");
        var entry = AddEntry(db, 1, ListStatusKeys.Finished);
        AddReview(db, entry, Now, ReviewVisibility.Public);
        AddReview(db, AddEntry(db, 2, ListStatusKeys.Finished), Now);
        AddPlaythrough(db, entry, Now, minutesPlayed: 600);
        AddPlaythrough(db, entry, Now);
        foreach (var state in new[] { ImportJobStates.Pending, ImportJobStates.Done, ImportJobStates.Done, ImportJobStates.Cancelled })
            db.ImportJobs.Add(new ImportJob { UserId = "a", Source = ImportSources.Grouvee, FileName = "export.json", State = state });
        db.SaveChanges();

        var stats = await NewService(db).GetAsync(CancellationToken.None);

        Assert.Equal(2, stats.Writing.Reviews);
        Assert.Equal(1, stats.Writing.PublicReviews);
        Assert.Equal(2, stats.Writing.Playthroughs);
        Assert.Equal(1, stats.Writing.TimedPlaythroughs);
        Assert.Equal(1, stats.Imports.Pending);
        Assert.Equal(2, stats.Imports.Done);
        Assert.Equal(1, stats.Imports.Cancelled);
    }

    [Fact]
    public async Task GetAsync_CountsTwelveWeeks_MondayToSundayInUtc()
    {
        using var db = NewDb();
        AddAccount(db, "a", createdAt: At(10, 12, 0, 10));
        AddAccount(db, "b", createdAt: At(10, 11, 23, 59));
        // 01:00 on Monday the 12th in UTC+3 is still Sunday the 11th in UTC: last week.
        AddAccount(db, "c", createdAt: At(10, 12, 1, 0, offsetHours: 3));
        // The Sunday before the first of the twelve weeks.
        AddAccount(db, "d", createdAt: At(7, 26, 23));
        db.UserGameEvents.Add(new UserGameEvent { UserId = "a", GameId = 1, OccurredAt = At(7, 27, 0) });
        db.SaveChanges();
        var entry = AddEntry(db, 1, ListStatusKeys.Playing);
        AddReview(db, entry, Now);
        AddPlaythrough(db, entry, At(8, 3));

        var weeks = (await NewService(db).GetAsync(CancellationToken.None)).Weeks;

        Assert.Equal(AdminStatsService.WeekCount, weeks.Count);
        Assert.Equal(new DateOnly(2026, 7, 27), weeks[0].Starts);
        Assert.Equal(new DateOnly(2026, 10, 12), weeks[^1].Starts);
        Assert.Equal(1, weeks[^1].SignUps);
        Assert.Equal(2, weeks[^2].SignUps);
        Assert.Equal(3, weeks.Sum(w => w.SignUps));
        Assert.Equal(1, weeks[0].ListMoves);
        Assert.Equal(1, weeks[^1].Reviews);
        Assert.Equal(1, weeks[1].Playthroughs);
    }

    [Theory]
    [InlineData("2026-10-12", "2026-10-12")]
    [InlineData("2026-10-13", "2026-10-12")]
    [InlineData("2026-10-18", "2026-10-12")]
    [InlineData("2026-10-11", "2026-10-05")]
    public void WeekStarting_IsTheWeeksMonday(string day, string monday) =>
        Assert.Equal(DateOnly.Parse(monday), AdminStatsService.WeekStarting(DateOnly.Parse(day)));
}
