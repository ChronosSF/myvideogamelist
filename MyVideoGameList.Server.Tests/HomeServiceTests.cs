using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// Which answers the home composite owns up to as degraded. It answers 200 either way, on purpose,
/// so the flag is all that stops a page built from a failure being kept as though it were the
/// page — by this process, and by the CDN in front of the SSR server. See
/// <c>docs/decisions/0013-http-caching-policy.md</c>.
/// </summary>
public class HomeServiceTests
{
    private static readonly DateTimeOffset Published = new(2026, 9, 1, 12, 0, 0, TimeSpan.Zero);

    /// <summary>When the tests compose the page: mid-morning in UTC on 17 October 2026.</summary>
    private static readonly DateTimeOffset Now = new(2026, 10, 17, 10, 0, 0, TimeSpan.Zero);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    /// <summary>A game with a cover, and with the wide artwork the hero needs only when asked for.</summary>
    private static GameDto Game(int id, string? artwork = null) =>
        new(id, $"Game {id}", null, null, $"https://images.example/cover-{id}.jpg", artwork,
            null, null, null, null, null, null, null,
            Platforms: [], Genres: [], Developers: [], Publishers: [], Details: null);

    private static NewsItemDto NewsFor(int gameId) =>
        new($"gid-{gameId}", gameId, $"Game {gameId}", null, "Patch notes", $"https://example.test/{gameId}",
            "Steam", null, Published);

    private static readonly CalendarCuratedEventDto NextFest =
        new(2, CuratedEventKinds.Fest, CuratedEventStores.Steam, "Steam Next Fest",
            new DateOnly(2026, 10, 19), new DateOnly(2026, 10, 26),
            "https://partner.steamgames.com/doc/marketing/upcoming_events");

    private static readonly CalendarShowcaseDto IdAtXbox =
        new(1197, "ID@Xbox October 2026 Showcase", new DateTimeOffset(2026, 10, 20, 17, 0, 0, TimeSpan.Zero),
            new DateTimeOffset(2026, 10, 20, 18, 0, 0, TimeSpan.Zero), null);

    /// <summary>What the calendar answers when nothing is on: an ordinary answer, not a failure.</summary>
    private static readonly CalendarEventsDto NothingOn = new([], [], Degraded: false);

    private static IIgdbService IgdbTrending(params GameDto[] games)
    {
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetTrendingAsync(Arg.Any<int>(), Arg.Any<CancellationToken>()).Returns(games);
        return igdb;
    }

    private static ISteamNewsService SteamReturning(params NewsItemDto[] news)
    {
        var steam = Substitute.For<ISteamNewsService>();
        steam.GetLatestNewsAsync(
                Arg.Any<IEnumerable<int>>(), Arg.Any<int>(), Arg.Any<int?>(), Arg.Any<CancellationToken>())
            .Returns(news);
        return steam;
    }

    private static ICalendarEventService CalendarReturning(CalendarEventsDto events)
    {
        var calendar = Substitute.For<ICalendarEventService>();
        calendar.GetAsync(Arg.Any<DateOnly>(), Arg.Any<DateOnly>(), Arg.Any<CancellationToken>()).Returns(events);
        return calendar;
    }

    private static readonly ComingSoonPicks NoPicks = new(new HashSet<int>(), new HashSet<int>());

    private static readonly ComingSoonDto GtaVi =
        new(52189, "Grand Theft Auto VI", null, "day", new DateOnly(2026, 11, 19), []);

    /// <summary>A Coming soon panel with no picks, composing to the games given.</summary>
    private static IComingSoonService ComingSoonReturning(params ComingSoonDto[] games)
    {
        var comingSoon = Substitute.For<IComingSoonService>();
        comingSoon.GetPicksAsync(Arg.Any<CancellationToken>()).Returns(NoPicks);
        comingSoon.ComposeAsync(Arg.Any<DateOnly>(), Arg.Any<ComingSoonPicks>(), Arg.Any<CancellationToken>())
            .Returns(games);
        return comingSoon;
    }

    private static HomeService NewService(
        IIgdbService igdb,
        ISteamNewsService steam,
        IMemoryCache? cache = null,
        ICalendarEventService? calendar = null,
        DateTimeOffset? now = null,
        IComingSoonService? comingSoon = null) =>
        new(igdb, steam, calendar ?? CalendarReturning(NothingOn), comingSoon ?? ComingSoonReturning(GtaVi),
            cache ?? new MemoryCache(new MemoryCacheOptions()), new FixedClock(now ?? Now), NullLogger<HomeService>.Instance);

    /// <summary>
    /// How long the service asked for its answer to be kept. A substitute rather than a clock,
    /// because what is asserted is the lifetime asked for, not the cache's own timekeeping.
    /// </summary>
    private static async Task<TimeSpan?> LifetimeOfAsync(
        IIgdbService igdb, ISteamNewsService steam, ICalendarEventService? calendar = null)
    {
        var entry = Substitute.For<ICacheEntry>();
        var cache = Substitute.For<IMemoryCache>();
        cache.CreateEntry(Arg.Any<object>()).Returns(entry);

        await NewService(igdb, steam, cache, calendar).GetHomeAsync();

        return entry.AbsoluteExpirationRelativeToNow;
    }

    [Fact]
    public async Task GetHomeAsync_TrendingThrows_AnswersEmptyAndDegraded()
    {
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetTrendingAsync(Arg.Any<int>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new HttpRequestException("IGDB is down"));
        var service = NewService(igdb, SteamReturning());

        var home = await service.GetHomeAsync();

        // Still an answer rather than an exception: the page renders without its rails.
        Assert.Null(home.Spotlight);
        Assert.Empty(home.Popular);
        Assert.Empty(home.News);
        Assert.True(home.Degraded);
    }

    [Fact]
    public async Task GetHomeAsync_TrendingComesBackEmpty_IsDegraded()
    {
        // IGDB answering with no popularity rows throws nothing — GetTrendingAsync returns empty —
        // and is the same empty page as the outage above. It is also all a removed field looks like.
        var service = NewService(IgdbTrending(), SteamReturning());

        var home = await service.GetHomeAsync();

        Assert.Empty(home.Popular);
        Assert.True(home.Degraded);
    }

    [Fact]
    public async Task GetHomeAsync_NewsComesBackEmpty_IsDegradedAndKeepsTheCovers()
    {
        // Reachable from an IGDB outage as well as a Steam one: the trending rail is answered from
        // an hour-long cache, and the lookups behind the news are then the first to fail.
        var service = NewService(IgdbTrending(Game(1, "https://images.example/art-1.jpg"), Game(2)), SteamReturning());

        var home = await service.GetHomeAsync();

        Assert.Equal([1, 2], home.Popular.Select(g => g.Id));
        Assert.Equal(1, home.Spotlight?.Id);
        Assert.True(home.Degraded);
    }

    [Fact]
    public async Task GetHomeAsync_BothRailsFilled_IsNotDegraded()
    {
        var service = NewService(
            IgdbTrending(Game(1), Game(2, "https://images.example/art-2.jpg")), SteamReturning(NewsFor(1)));

        var home = await service.GetHomeAsync();

        // The first game with artwork, not the first game: the hero needs a wide image.
        Assert.Equal(2, home.Spotlight?.Id);
        Assert.Equal([NewsFor(1)], home.News);
        Assert.False(home.Degraded);
    }

    [Fact]
    public async Task GetHomeAsync_NoGameHasArtwork_IsNotDegraded()
    {
        // Plenty of IGDB entries have no artwork, so a missing spotlight is an ordinary answer: the
        // hero falls back to its gradient, and nothing upstream failed.
        var service = NewService(IgdbTrending(Game(1), Game(2)), SteamReturning(NewsFor(1)));

        var home = await service.GetHomeAsync();

        Assert.Null(home.Spotlight);
        Assert.False(home.Degraded);
    }

    [Fact]
    public async Task GetHomeAsync_ShowcasesAndSalesAnswered_CarriesThemAndIsNotDegraded()
    {
        var events = new CalendarEventsDto([NextFest], [IdAtXbox], Degraded: false);
        var service = NewService(
            IgdbTrending(Game(1)), SteamReturning(NewsFor(1)), calendar: CalendarReturning(events));

        var home = await service.GetHomeAsync();

        Assert.Same(events, home.Events);
        Assert.False(home.Degraded);
    }

    [Fact]
    public async Task GetHomeAsync_NothingOnInTheTwoWeeks_IsNotDegraded()
    {
        // Unlike the rails, the panel is empty for a true reason most of the year — no sale entered, no
        // showcase named — and an empty panel is not drawn rather than drawn as a failure. Read as degraded,
        // every quiet fortnight would take the whole front page off the edge.
        var service = NewService(IgdbTrending(Game(1)), SteamReturning(NewsFor(1)), calendar: CalendarReturning(NothingOn));

        var home = await service.GetHomeAsync();

        Assert.Empty(home.Events.Curated);
        Assert.Empty(home.Events.Showcases);
        Assert.False(home.Degraded);
    }

    [Fact]
    public async Task GetHomeAsync_ShowcasesMissing_IsDegradedAndKeepsTheSalesAndTheRails()
    {
        // IGDB could not be asked for the showcases. The calendar's service still answers, with the sales,
        // which are ours, and says what is missing; the page shows what it has and is not kept.
        var events = new CalendarEventsDto([NextFest], [], Degraded: true);
        var service = NewService(
            IgdbTrending(Game(1)), SteamReturning(NewsFor(1)), calendar: CalendarReturning(events));

        var home = await service.GetHomeAsync();

        Assert.Equal("Steam Next Fest", Assert.Single(home.Events.Curated).Name);
        Assert.True(home.Events.Degraded);
        Assert.Equal([1], home.Popular.Select(g => g.Id));
        Assert.Equal([NewsFor(1)], home.News);
        Assert.True(home.Degraded);
    }

    [Fact]
    public async Task GetHomeAsync_EventsCannotBeRead_CostsThePanelAndNothingElse()
    {
        // Our own tables failing to answer. Uncaught, it would have taken down a page that read no table
        // of ours until this panel; caught, the panel is missing and says so, and the rails are whole.
        var calendar = Substitute.For<ICalendarEventService>();
        calendar.GetAsync(Arg.Any<DateOnly>(), Arg.Any<DateOnly>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new InvalidOperationException("The database is unreachable."));
        var service = NewService(
            IgdbTrending(Game(1, "https://images.example/art-1.jpg")), SteamReturning(NewsFor(1)), calendar: calendar);

        var home = await service.GetHomeAsync();

        Assert.Empty(home.Events.Curated);
        Assert.Empty(home.Events.Showcases);
        Assert.True(home.Events.Degraded);
        Assert.Equal(1, home.Spotlight?.Id);
        Assert.Equal([NewsFor(1)], home.News);
        Assert.True(home.Degraded);
    }

    [Fact]
    public async Task GetHomeAsync_ComingSoonComposes_CarriesItForUtcTodayAndStaysWhole()
    {
        var comingSoon = ComingSoonReturning(GtaVi);
        var service = NewService(
            IgdbTrending(Game(1, "https://images.example/art-1.jpg")), SteamReturning(NewsFor(1)), comingSoon: comingSoon);

        var home = await service.GetHomeAsync();

        Assert.Equal([GtaVi], home.ComingSoon);
        Assert.False(home.Degraded);
        await comingSoon.Received(1).ComposeAsync(new DateOnly(2026, 10, 17), NoPicks, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task GetHomeAsync_NothingComingSoonPassesTheRules_IsAnAnswerNotAFailure()
    {
        var service = NewService(
            IgdbTrending(Game(1, "https://images.example/art-1.jpg")), SteamReturning(NewsFor(1)), comingSoon: ComingSoonReturning());

        var home = await service.GetHomeAsync();

        Assert.Empty(home.ComingSoon);
        Assert.False(home.Degraded);
    }

    [Fact]
    public async Task GetHomeAsync_IgdbFailsForComingSoon_CostsThePanelAndNothingElse()
    {
        var comingSoon = Substitute.For<IComingSoonService>();
        comingSoon.GetPicksAsync(Arg.Any<CancellationToken>()).Returns(NoPicks);
        comingSoon.ComposeAsync(Arg.Any<DateOnly>(), Arg.Any<ComingSoonPicks>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new HttpRequestException("IGDB is down."));
        var service = NewService(
            IgdbTrending(Game(1, "https://images.example/art-1.jpg")), SteamReturning(NewsFor(1)), comingSoon: comingSoon);

        var home = await service.GetHomeAsync();

        Assert.Empty(home.ComingSoon);
        Assert.Equal([NewsFor(1)], home.News);
        Assert.True(home.Degraded);
    }

    [Fact]
    public async Task GetHomeAsync_PicksCannotBeRead_LeavesThePanelOutRatherThanShowWhatWasHidden()
    {
        // Composed without the picks, a hidden game would be back on the front page.
        var comingSoon = Substitute.For<IComingSoonService>();
        comingSoon.GetPicksAsync(Arg.Any<CancellationToken>())
            .ThrowsAsync(new InvalidOperationException("The database is unreachable."));
        var service = NewService(
            IgdbTrending(Game(1, "https://images.example/art-1.jpg")), SteamReturning(NewsFor(1)), comingSoon: comingSoon);

        var home = await service.GetHomeAsync();

        Assert.Empty(home.ComingSoon);
        Assert.True(home.Degraded);
        await comingSoon.DidNotReceiveWithAnyArgs().ComposeAsync(default, NoPicks, default);
    }

    [Theory]
    // Mid-morning: the readers' days run from the 16th, west of Greenwich, to the 18th, far east of it.
    [InlineData("2026-10-17T10:00:00Z", "2026-10-16", "2026-11-01")]
    // A second either side of UTC midnight is a day either side, whatever the server's own timezone is.
    [InlineData("2026-10-17T23:59:59Z", "2026-10-16", "2026-11-01")]
    [InlineData("2026-10-18T00:00:00Z", "2026-10-17", "2026-11-02")]
    // An instant given in another offset is still read in UTC: 01:00 in Sofia is 22:00 the day before.
    [InlineData("2026-10-18T01:00:00+03:00", "2026-10-16", "2026-11-01")]
    public void EventsWindow_AnyInstant_SpansUtcYesterdayToTheFourteenthAfterToday(string now, string from, string to)
    {
        var window = HomeService.EventsWindow(DateTimeOffset.Parse(now));

        Assert.Equal((DateOnly.Parse(from), DateOnly.Parse(to)), window);
    }

    [Theory]
    // Composed as a UTC day begins, and a second before it ends.
    [InlineData("2026-10-17T00:00:00Z")]
    [InlineData("2026-10-17T23:59:59Z")]
    public void EventsWindow_ServedHalfAnHourAfterComposing_StillCoversEveryReader(string composedAt)
    {
        // Served at once, and half an hour later: its fifteen minutes in this process, then five fresh at the
        // edge and ten more served stale (ADR 0013's later note). The readers' days at any instant run from
        // twelve hours behind UTC to fourteen ahead of it, and each reader keeps today and the thirteen after.
        var composed = DateTimeOffset.Parse(composedAt);
        var (from, to) = HomeService.EventsWindow(composed);

        foreach (var servedAt in new[] { composed, composed.AddMinutes(30) })
        {
            foreach (var offset in new[] { TimeSpan.FromHours(-12), TimeSpan.Zero, TimeSpan.FromHours(14) })
            {
                var readersToday = DateOnly.FromDateTime(servedAt.ToOffset(offset).DateTime);
                var readersLastDay = readersToday.AddDays(HomeService.EventDays - 1);

                Assert.True(readersToday >= from, $"A reader at {offset} on {readersToday} starts before {from}.");
                Assert.True(readersLastDay < to, $"A reader at {offset} on {readersToday} ends after {to}.");
            }
        }
    }

    [Fact]
    public async Task GetHomeAsync_ComposedMidMorning_AsksTheCalendarAboutTheWidenedWindow()
    {
        var calendar = CalendarReturning(NothingOn);
        var service = NewService(IgdbTrending(Game(1)), SteamReturning(NewsFor(1)), calendar: calendar);

        await service.GetHomeAsync();

        await calendar.Received(1).GetAsync(new DateOnly(2026, 10, 16), new DateOnly(2026, 11, 1), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task GetHomeAsync_DegradedAnswer_IsKeptForLessTimeThanAHealthyOne()
    {
        // The same judgement picks both, so a failure the flag owns up to is never the one this
        // process goes on serving for the full window. Every degraded path, not only the exception.
        var igdbDown = Substitute.For<IIgdbService>();
        igdbDown.GetTrendingAsync(Arg.Any<int>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new HttpRequestException("IGDB is down"));
        var tablesDown = Substitute.For<ICalendarEventService>();
        tablesDown.GetAsync(Arg.Any<DateOnly>(), Arg.Any<DateOnly>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new InvalidOperationException("The database is unreachable."));

        var healthy = await LifetimeOfAsync(IgdbTrending(Game(1)), SteamReturning(NewsFor(1)));
        var outage = await LifetimeOfAsync(igdbDown, SteamReturning());
        var noTrending = await LifetimeOfAsync(IgdbTrending(), SteamReturning());
        var noNews = await LifetimeOfAsync(IgdbTrending(Game(1)), SteamReturning());
        var noShowcases = await LifetimeOfAsync(
            IgdbTrending(Game(1)), SteamReturning(NewsFor(1)), CalendarReturning(new CalendarEventsDto([NextFest], [], Degraded: true)));
        var noEvents = await LifetimeOfAsync(IgdbTrending(Game(1)), SteamReturning(NewsFor(1)), tablesDown);

        Assert.NotNull(healthy);
        Assert.All([outage, noTrending, noNews, noShowcases, noEvents], degraded =>
        {
            Assert.NotNull(degraded);
            Assert.True(degraded < healthy, $"A degraded answer was kept for {degraded}, a healthy one for {healthy}.");
        });
    }

    [Fact]
    public async Task GetHomeAsync_DegradedAnswerServedFromCache_StillSaysSo()
    {
        // For the minute the failure is kept, every response built from it has to carry the flag,
        // or the first visitor's page is uncached and the second's is pinned at the edge.
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetTrendingAsync(Arg.Any<int>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new HttpRequestException("IGDB is down"));
        var service = NewService(igdb, SteamReturning());

        await service.GetHomeAsync();
        var second = await service.GetHomeAsync();

        Assert.True(second.Degraded);
        await igdb.Received(1).GetTrendingAsync(Arg.Any<int>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task GetHomeAsync_ServedFromCache_DoesNotReadTheEventsAgain()
    {
        // The showcases and sales are kept with the rest of the composite, so the admin page's tables are
        // read once per composition rather than once per visitor.
        var calendar = CalendarReturning(new CalendarEventsDto([NextFest], [], Degraded: false));
        var service = NewService(IgdbTrending(Game(1)), SteamReturning(NewsFor(1)), calendar: calendar);

        var first = await service.GetHomeAsync();
        var second = await service.GetHomeAsync();

        Assert.Same(first, second);
        await calendar.Received(1).GetAsync(Arg.Any<DateOnly>(), Arg.Any<DateOnly>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task GetHomeAsync_TrendingStillOut_AsksForTheEventsAlready()
    {
        // Side by side, not one after the other: when IGDB accepts a connection and never answers, each
        // waits out its thirty-second ceiling, and in series the two would reach the edge's minute.
        var trending = new TaskCompletionSource<IEnumerable<GameDto>>();
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetTrendingAsync(Arg.Any<int>(), Arg.Any<CancellationToken>()).Returns(trending.Task);
        var calendar = CalendarReturning(NothingOn);
        var service = NewService(igdb, SteamReturning(NewsFor(1)), calendar: calendar);

        var composing = service.GetHomeAsync();

        await calendar.Received(1).GetAsync(Arg.Any<DateOnly>(), Arg.Any<DateOnly>(), Arg.Any<CancellationToken>());
        Assert.False(composing.IsCompleted);

        trending.SetResult([Game(1)]);
        var home = await composing;

        Assert.Equal([1], home.Popular.Select(g => g.Id));
        Assert.False(home.Degraded);
    }

    [Fact]
    public async Task GetHomeAsync_TrendingTimesOut_IsDegradedRatherThanThrown()
    {
        // A timeout of somebody else's throws an OperationCanceledException too. Nobody cancelled this
        // request, so it is IGDB failing, and costs the rails rather than the page.
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetTrendingAsync(Arg.Any<int>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new TaskCanceledException("The request was canceled due to the configured timeout."));
        var service = NewService(igdb, SteamReturning());

        var home = await service.GetHomeAsync();

        Assert.Empty(home.Popular);
        Assert.True(home.Degraded);
    }

    [Fact]
    public async Task GetHomeAsync_EventsReadTimesOut_IsDegradedRatherThanThrown()
    {
        // The same for the panel: a read of ours that times out costs the panel, not the page.
        var calendar = Substitute.For<ICalendarEventService>();
        calendar.GetAsync(Arg.Any<DateOnly>(), Arg.Any<DateOnly>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new TaskCanceledException("A timeout of the database's own."));
        var service = NewService(IgdbTrending(Game(1)), SteamReturning(NewsFor(1)), calendar: calendar);

        var home = await service.GetHomeAsync();

        Assert.True(home.Events.Degraded);
        Assert.Equal([1], home.Popular.Select(g => g.Id));
        Assert.True(home.Degraded);
    }

    [Fact]
    public async Task GetHomeAsync_CallerCancels_ThrowsAndKeepsNothing()
    {
        // A reader who left is not an upstream failure. Swallowed as one, a single abandoned request
        // would leave an empty front page in the cache for everybody who came after it.
        using var left = new CancellationTokenSource();
        await left.CancelAsync();
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetTrendingAsync(Arg.Any<int>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new OperationCanceledException(left.Token));
        var cache = Substitute.For<IMemoryCache>();
        var service = NewService(igdb, SteamReturning(), cache);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.GetHomeAsync(left.Token));

        cache.DidNotReceiveWithAnyArgs().CreateEntry(default!);
    }

    [Fact]
    public async Task GetHomeAsync_CallerCancelsWhileTheEventsAreRead_ThrowsAndKeepsNothing()
    {
        // The same for the panel: its catch is for our tables failing, not for a reader leaving, and taking
        // one for the other would cache a page with no panel for a minute.
        using var left = new CancellationTokenSource();
        var calendar = Substitute.For<ICalendarEventService>();
        calendar.GetAsync(Arg.Any<DateOnly>(), Arg.Any<DateOnly>(), Arg.Any<CancellationToken>())
            .Returns(async call =>
            {
                await left.CancelAsync();
                call.Arg<CancellationToken>().ThrowIfCancellationRequested();
                return NothingOn;
            });
        var cache = Substitute.For<IMemoryCache>();
        var service = NewService(IgdbTrending(Game(1)), SteamReturning(NewsFor(1)), cache, calendar);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.GetHomeAsync(left.Token));

        cache.DidNotReceiveWithAnyArgs().CreateEntry(default!);
    }
}
