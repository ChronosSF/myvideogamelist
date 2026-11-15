using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// What a reader can report, and what reporting it again does (ADR 0076 §1).
/// </summary>
public class ContentReportServiceTests
{
    private const string Reader = "reader";
    private const int GameId = 1942;

    private static readonly DateTimeOffset Midday = new(2026, 11, 2, 12, 0, 0, TimeSpan.Zero);

    private sealed class Clock(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;
        public override DateTimeOffset GetUtcNow() => Now;
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

    private static ContentReportService NewService(ApplicationDbContext db, TimeProvider? clock = null) =>
        new(db, new UpperInvariantLookupNormalizer(), clock ?? new Clock(Midday));

    private static string AddAccount(
        ApplicationDbContext db, string userName, string visibility = ProfileVisibility.Public)
    {
        var id = $"id-{userName.ToLowerInvariant()}";
        db.Users.Add(new ApplicationUser
        {
            Id = id,
            UserName = userName,
            NormalizedUserName = userName.ToUpperInvariant(),
            Email = $"{userName}@test.local",
            ProfileVisibility = visibility,
        });
        db.SaveChanges();
        return id;
    }

    private static int AddReview(
        ApplicationDbContext db,
        string userId,
        string visibility = ReviewVisibility.Public,
        DateTimeOffset? hiddenAt = null,
        int gameId = GameId)
    {
        var review = new Review
        {
            UserId = userId,
            Entry = new UserGameEntry { UserId = userId, GameId = gameId, AddedAt = Midday },
            Body = "Words.",
            Visibility = visibility,
            CreatedAt = Midday,
            UpdatedAt = Midday,
            HiddenAt = hiddenAt,
        };
        db.Reviews.Add(review);
        db.SaveChanges();
        return review.Id;
    }

    private static ReportInputDto Report(string userName, int? gameId = GameId, string reason = ReportReason.Spam, string? note = null) =>
        new(userName, gameId, reason, note);

    [Fact]
    public async Task ReportAsync_APublishedReview_IsRecordedAgainstThatReviewAlone()
    {
        using var db = NewDb();
        AddAccount(db, Reader);
        var reviewId = AddReview(db, AddAccount(db, "alex"));

        Assert.True(await NewService(db).ReportAsync("id-reader", Report("alex", note: "A link farm.")));

        var report = Assert.Single(db.ContentReports);
        Assert.Equal(("id-reader", reviewId, null, ReportReason.Spam, "A link farm.", Midday),
            (report.UserId, report.ReviewId, report.ProfileUserId, report.Reason, report.Note, report.CreatedAt));
    }

    [Fact]
    public async Task ReportAsync_APublicProfile_IsRecordedAgainstTheAccount()
    {
        using var db = NewDb();
        var alex = AddAccount(db, "alex");

        Assert.True(await NewService(db).ReportAsync("id-reader", Report("alex", gameId: null, ReportReason.Impersonation)));

        var report = Assert.Single(db.ContentReports);
        Assert.Equal((null, alex, ReportReason.Impersonation), (report.ReviewId, report.ProfileUserId, report.Reason));
    }

    [Fact]
    public async Task ReportAsync_AgainByTheSameReader_ReplacesTheReasonAndNoteAndKeepsTheFirstMoment()
    {
        // One reader, one report of each thing: the index holds it, and the service answers it as an
        // edit rather than as a second row or a refusal. The first moment is the queue's order.
        using var db = NewDb();
        AddReview(db, AddAccount(db, "alex"));
        var clock = new Clock(Midday);
        await NewService(db, clock).ReportAsync("id-reader", Report("alex", note: "First."));
        clock.Now = Midday.AddHours(1);

        Assert.True(await NewService(db, clock).ReportAsync("id-reader", Report("alex", reason: ReportReason.Abuse, note: "  ")));

        var report = Assert.Single(db.ContentReports);
        Assert.Equal((ReportReason.Abuse, null, Midday), (report.Reason, report.Note, report.CreatedAt));
    }

    [Fact]
    public async Task ReportAsync_ByTwoReaders_IsTwoReports()
    {
        using var db = NewDb();
        AddReview(db, AddAccount(db, "alex"));

        await NewService(db).ReportAsync("id-reader", Report("alex"));
        await NewService(db).ReportAsync("id-sam", Report("alex"));

        Assert.Equal(2, db.ContentReports.Count());
    }

    [Fact]
    public async Task ReportAsync_AReviewAndItsAuthorsProfile_AreTwoThings()
    {
        using var db = NewDb();
        AddReview(db, AddAccount(db, "alex"));

        await NewService(db).ReportAsync("id-reader", Report("alex"));
        await NewService(db).ReportAsync("id-reader", Report("alex", gameId: null));

        Assert.Equal(2, db.ContentReports.Count());
    }

    [Fact]
    public async Task ReportAsync_AnyLetterCase_FindsTheProfile()
    {
        using var db = NewDb();
        AddReview(db, AddAccount(db, "Alex"));

        Assert.True(await NewService(db).ReportAsync("id-reader", Report(" ALEX ")));
    }

    [Fact]
    public async Task ReportAsync_ANote_IsKeptTrimmed()
    {
        using var db = NewDb();
        AddAccount(db, "alex");

        await NewService(db).ReportAsync("id-reader", Report("alex", gameId: null, note: "\n  That is my name.  \n"));

        Assert.Equal("That is my name.", Assert.Single(db.ContentReports).Note);
    }

    public static TheoryData<string> WhatIsNotPublished() =>
    [
        "a private review",
        "a hidden review",
        "a public review on a private profile",
        "a private profile",
        "an unclaimed name",
        "a game the author has not reviewed",
    ];

    [Theory]
    [MemberData(nameof(WhatIsNotPublished))]
    public async Task ReportAsync_WhatAReaderCannotSee_IsNotFoundAndRecordsNothing(string what)
    {
        // The public reads' gates, and the same answer for every one of them, so the endpoint cannot be
        // used to ask whether a name has an account (ADR 0027 §7).
        using var db = NewDb();
        ReportInputDto input;
        switch (what)
        {
            case "a private review":
                AddReview(db, AddAccount(db, "alex"), ReviewVisibility.Private);
                input = Report("alex");
                break;
            case "a hidden review":
                AddReview(db, AddAccount(db, "alex"), hiddenAt: Midday);
                input = Report("alex");
                break;
            case "a public review on a private profile":
                AddReview(db, AddAccount(db, "alex", ProfileVisibility.Private));
                input = Report("alex");
                break;
            case "a private profile":
                AddAccount(db, "alex", ProfileVisibility.Private);
                input = Report("alex", gameId: null);
                break;
            case "an unclaimed name":
                input = Report("nobody", gameId: null);
                break;
            default:
                AddReview(db, AddAccount(db, "alex"), gameId: 7);
                input = Report("alex");
                break;
        }

        Assert.False(await NewService(db).ReportAsync("id-reader", input));
        Assert.Empty(db.ContentReports);
    }
}
