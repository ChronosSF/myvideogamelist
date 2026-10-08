using System.ComponentModel.DataAnnotations;
using System.Net;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Models.Igdb;
using MyVideoGameList.Server.Services;
using MyVideoGameList.Server.Services.Releases;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace MyVideoGameList.Server.Tests;

/// <summary>The events query's text, and what a row of IGDB's becomes.</summary>
public class CalendarEventQueryTests
{
    private static long Unix(DateOnly day) =>
        new DateTimeOffset(day.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero).ToUnixTimeSeconds();

    [Fact]
    public void BuildEventsQuery_AsksADayWiderAtEachEnd_ForWhateverTheReadersDayIs()
    {
        // The line's two weeks from 6 October. Somebody in Kiribati starts the 6th at 10:00 UTC on the 5th,
        // and a show at that hour is on their 6th.
        var query = IgdbService.BuildEventsQuery(new DateOnly(2026, 10, 6), new DateOnly(2026, 10, 20), offset: 0);

        var starts = Unix(new DateOnly(2026, 10, 5));
        var ends = Unix(new DateOnly(2026, 10, 21));
        Assert.Contains(
            $"where start_time < {ends} & (end_time >= {starts} | (end_time = null & start_time >= {starts}));",
            query);
    }

    [Fact]
    public void BuildEventsQuery_AsksOnlyWhatIsReadAndPagesInIdOrder()
    {
        var query = IgdbService.BuildEventsQuery(new DateOnly(2026, 10, 6), new DateOnly(2026, 10, 20), offset: 500);

        Assert.Contains("fields name,start_time,end_time,live_stream_url;", query);
        Assert.Contains("sort id asc;", query);
        Assert.Contains("limit 500;", query);
        Assert.Contains("offset 500;", query);
    }

    [Theory]
    [InlineData("0001-01-01", "0001-01-02")]
    [InlineData("9999-12-30", "9999-12-31")]
    public void BuildEventsQuery_AWindowAtEitherEndOfWhatADateCanHold_IsStillWidened(string from, string to)
    {
        // Validation accepts both, and a day stepped outside DateOnly would throw: a 500 for a well-formed
        // request, as it was for the releases' window on #168.
        var first = DateOnly.Parse(from);
        var last = DateOnly.Parse(to);

        var query = IgdbService.BuildEventsQuery(first, last, offset: 0);

        Assert.Contains($"start_time < {Unix(last) + 86_400}", query);
        Assert.Contains($"end_time >= {Unix(first) - 86_400}", query);
    }

    [Fact]
    public void MapToGameEvent_ARowWithNothingToShow_IsNothing()
    {
        Assert.Null(IgdbService.MapToGameEvent(new IgdbEvent(1, "  ", 1780689600, null, null)));
        Assert.Null(IgdbService.MapToGameEvent(new IgdbEvent(1, "Summer Game Fest 2026", null, null, null)));
    }

    [Fact]
    public void MapToGameEvent_AnEndBeforeTheStart_IsNoEnd()
    {
        var mapped = IgdbService.MapToGameEvent(new IgdbEvent(1, "Typo", 1780689600, 1780689599, null));

        Assert.Null(mapped!.EndsAt);
    }

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("ftp://example.com/stream")]
    [InlineData("www.youtube.com/watch?v=x")]
    public void MapToGameEvent_AnAddressALinkCannotSafelyPointAt_IsDropped(string url)
    {
        // The line renders it as a link, as it does a curated event's, which is held to the same two schemes.
        var mapped = IgdbService.MapToGameEvent(new IgdbEvent(1, "Some Show", 1780689600, null, url));

        Assert.Null(mapped!.LiveStreamUrl);
    }
}

/// <summary>
/// <see cref="IgdbService.GetEventsAsync"/> against IGDB's own JSON, recorded on 2026-10-06 — the binding of
/// <c>start_time</c>, <c>end_time</c> and <c>live_stream_url</c>, which no test of the mapping reaches.
/// </summary>
public class CalendarEventJsonTests
{
    /// <summary>
    /// Live rows: two June showcases, one with no stream and one streamed over plain http, SAGE's week, and
    /// a State of Play from 2024 that IGDB gave no end.
    /// </summary>
    private const string EventsPayload = """
        [
          { "id": 1160, "name": "GamingUp Showcase 2026", "start_time": 1787508000, "end_time": 1787515200 },
          { "id": 1050, "name": "Summer Game Fest 2026", "start_time": 1780689600, "end_time": 1780696800, "live_stream_url": "https://www.youtube.com/watch?v=QdNmVWXuYec" },
          { "id": 1147, "name": "Gamescom Opening Night Live 2026", "start_time": 1787680800, "end_time": 1787688000, "live_stream_url": "http://youtube.com/watch?v=Zzvzt3IjNik" },
          { "id": 1140, "name": "SAGE 2026", "start_time": 1789084800, "end_time": 1789775999 },
          { "id": 500, "name": "State of Play: 2024-05-30", "start_time": 1717110000 }
        ]
        """;

    private const string TokenPayload =
        """{ "access_token": "token", "expires_in": 3600, "token_type": "bearer" }""";

    private sealed class StubHandler : HttpMessageHandler
    {
        public List<string> Queries { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.RequestUri?.Host == "id.twitch.tv") return Json(TokenPayload);

            Assert.EndsWith("/events", request.RequestUri!.AbsolutePath);
            Queries.Add(await request.Content!.ReadAsStringAsync(cancellationToken));
            return Json(EventsPayload);
        }

        private static HttpResponseMessage Json(string body) =>
            new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
    }

    private static (IgdbService Service, StubHandler Igdb) NewService()
    {
        var handler = new StubHandler();

        var factory = Substitute.For<IHttpClientFactory>();
        factory.CreateClient("Igdb").Returns(_ => new HttpClient(handler));

        var configuration = Substitute.For<IConfiguration>();
        configuration["Igdb:ClientId"].Returns("client-id");
        configuration["Igdb:ClientSecret"].Returns("client-secret");

        var service = new IgdbService(
            factory, configuration, new MemoryCache(new MemoryCacheOptions()), NullLogger<IgdbService>.Instance);

        return (service, handler);
    }

    private static DateTimeOffset Utc(int year, int month, int day, int hour, int minute = 0, int second = 0) =>
        new(year, month, day, hour, minute, second, TimeSpan.Zero);

    [Fact]
    public async Task GetEventsAsync_BindsTheInstantsAndTheStream_EarliestFirst()
    {
        var (service, _) = NewService();

        var events = await service.GetEventsAsync(new DateOnly(2026, 6, 1), new DateOnly(2026, 6, 15));

        Assert.Equal(
            [
                new GameEvent(500, "State of Play: 2024-05-30", Utc(2024, 5, 30, 23), null, null),
                new GameEvent(1050, "Summer Game Fest 2026", Utc(2026, 6, 5, 20), Utc(2026, 6, 5, 22),
                    "https://www.youtube.com/watch?v=QdNmVWXuYec"),
                new GameEvent(1160, "GamingUp Showcase 2026", Utc(2026, 8, 23, 18), Utc(2026, 8, 23, 20), null),
                new GameEvent(1147, "Gamescom Opening Night Live 2026", Utc(2026, 8, 25, 18), Utc(2026, 8, 25, 20),
                    "http://youtube.com/watch?v=Zzvzt3IjNik"),
                new GameEvent(1140, "SAGE 2026", Utc(2026, 9, 11, 0), Utc(2026, 9, 18, 23, 59, 59), null),
            ],
            events);
    }

    [Fact]
    public async Task GetEventsAsync_AsksIgdbOncePerWindow()
    {
        // The same for everybody, so the second reader of the same days is answered from memory.
        var (service, igdb) = NewService();

        await service.GetEventsAsync(new DateOnly(2026, 10, 6), new DateOnly(2026, 10, 20));
        await service.GetEventsAsync(new DateOnly(2026, 10, 6), new DateOnly(2026, 10, 20));
        await service.GetEventsAsync(new DateOnly(2026, 10, 7), new DateOnly(2026, 10, 21));

        Assert.Equal(2, igdb.Queries.Count);
    }
}

/// <summary>The service around the query: our two tables, the names that pick the showcases, and IGDB failing.</summary>
public class CalendarEventServiceTests
{
    private static readonly DateOnly From = new(2026, 10, 6);
    private static readonly DateOnly To = new(2026, 10, 20);

    private static readonly GameEvent SummerGameFest =
        new(1050, "Summer Game Fest 2026", new DateTimeOffset(2026, 10, 9, 20, 0, 0, TimeSpan.Zero), null, "https://www.youtube.com/watch?v=QdNmVWXuYec");

    private static readonly GameEvent DayOfTheDevs =
        new(1121, "Day of the Devs: Summer Game Fest Digital Showcase 2026", new DateTimeOffset(2026, 10, 9, 22, 0, 0, TimeSpan.Zero), null, null);

    private static readonly GameEvent StateOfPlay =
        new(1111, "State of Play | June 2, 2026", new DateTimeOffset(2026, 10, 12, 21, 0, 0, TimeSpan.Zero), null, null);

    private static readonly GameEvent XboxShowcase =
        new(1082, "Xbox Games Showcase 2026", new DateTimeOffset(2026, 10, 14, 17, 0, 0, TimeSpan.Zero), null, null);

    private static ApplicationDbContext NewDb() =>
        new(new DbContextOptionsBuilder<ApplicationDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static void Curate(ApplicationDbContext db, string name, DateOnly startsOn, DateOnly endsOn) =>
        db.CuratedEvents.Add(new CuratedEvent
        {
            Kind = CuratedEventKinds.Sale,
            Store = CuratedEventStores.Steam,
            Name = name,
            StartsOn = startsOn,
            EndsOn = endsOn,
            Url = "https://partner.steamgames.com/doc/marketing/upcoming_events",
        });

    private static void Name(ApplicationDbContext db, string prefix) =>
        db.ShowcaseNames.Add(new ShowcaseName { Prefix = prefix, NormalizedPrefix = ShowcaseName.Normalise(prefix) });

    private static IIgdbService Igdb(params GameEvent[] events)
    {
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetEventsAsync(Arg.Any<DateOnly>(), Arg.Any<DateOnly>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromResult<IReadOnlyList<GameEvent>>(events));
        return igdb;
    }

    private static CalendarEventService NewService(ApplicationDbContext db, IIgdbService igdb) =>
        new(db, igdb, NullLogger<CalendarEventService>.Instance);

    [Fact]
    public async Task GetAsync_GivesTheCuratedEventsThatOverlapTheWindow_EarliestFirst()
    {
        using var db = NewDb();
        Curate(db, "Ended the day before", new DateOnly(2026, 9, 28), new DateOnly(2026, 10, 5));
        Curate(db, "Steam Next Fest", new DateOnly(2026, 10, 19), new DateOnly(2026, 10, 26));
        Curate(db, "Steam Autumn Sale", new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 6));
        Curate(db, "Starts the day after", To, new DateOnly(2026, 10, 25));
        await db.SaveChangesAsync();

        var answer = await NewService(db, Igdb()).GetAsync(From, To);

        // The last day is inclusive and the window's end is not: the sale ending on its first day is in it,
        // and the fest starting the day it ends is not.
        Assert.Equal(["Steam Autumn Sale", "Steam Next Fest"], answer.Curated.Select(e => e.Name));
        Assert.False(answer.Degraded);
    }

    [Fact]
    public async Task GetAsync_WithNoShowcaseNames_DoesNotAskIgdb()
    {
        // The list starts empty (E1), and with no name to match nothing IGDB has could be shown.
        using var db = NewDb();
        var igdb = Igdb(SummerGameFest);

        var answer = await NewService(db, igdb).GetAsync(From, To);

        Assert.Empty(answer.Showcases);
        Assert.False(answer.Degraded);
        await igdb.DidNotReceive().GetEventsAsync(Arg.Any<DateOnly>(), Arg.Any<DateOnly>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task GetAsync_ShowsTheEventsWhoseNamesStartWithAShowcaseName_IgnoringCase()
    {
        using var db = NewDb();
        Name(db, "Summer Game Fest");
        Name(db, "state of play");
        await db.SaveChangesAsync();

        var answer = await NewService(db, Igdb(SummerGameFest, DayOfTheDevs, StateOfPlay, XboxShowcase)).GetAsync(From, To);

        // Day of the Devs names Summer Game Fest, but does not start with it: a satellite show.
        Assert.Equal(["Summer Game Fest 2026", "State of Play | June 2, 2026"], answer.Showcases.Select(s => s.Name));

        var fest = answer.Showcases[0];
        Assert.Equal(SummerGameFest.StartsAt, fest.StartsAt);
        Assert.Equal(SummerGameFest.LiveStreamUrl, fest.Url);
    }

    [Fact]
    public async Task GetAsync_WhenIgdbFails_StillGivesTheSalesAndSaysTheShowcasesAreMissing()
    {
        using var db = NewDb();
        Curate(db, "Steam Autumn Sale", new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 15));
        Name(db, "Summer Game Fest");
        await db.SaveChangesAsync();

        var igdb = Substitute.For<IIgdbService>();
        igdb.GetEventsAsync(Arg.Any<DateOnly>(), Arg.Any<DateOnly>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new HttpRequestException("IGDB is down"));

        var answer = await NewService(db, igdb).GetAsync(From, To);

        Assert.True(answer.Degraded);
        Assert.Empty(answer.Showcases);
        Assert.Equal("Steam Autumn Sale", Assert.Single(answer.Curated).Name);
    }

    [Fact]
    public async Task GetAsync_WhenTheReaderLeaves_IsCancelledRatherThanDegraded()
    {
        // A request nobody is waiting for is a 499, not an answer that says IGDB failed.
        using var db = NewDb();
        Name(db, "Summer Game Fest");
        await db.SaveChangesAsync();

        using var left = new CancellationTokenSource();
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetEventsAsync(Arg.Any<DateOnly>(), Arg.Any<DateOnly>(), Arg.Any<CancellationToken>())
            .Returns(async call =>
            {
                await left.CancelAsync();
                call.Arg<CancellationToken>().ThrowIfCancellationRequested();
                return (IReadOnlyList<GameEvent>)[];
            });

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => NewService(db, igdb).GetAsync(From, To, left.Token));
    }
}

/// <summary>The window's rules, which are the releases' — the line asks both about the same days.</summary>
public class CalendarWindowQueryTests
{
    private static List<ValidationResult> Validate(CalendarWindowQuery window) =>
        window.Validate(new ValidationContext(window)).ToList();

    [Fact]
    public void Validate_TheLinesTwoWeeks_IsAWindow()
    {
        Assert.Empty(Validate(new CalendarWindowQuery(new DateOnly(2026, 10, 6), new DateOnly(2026, 10, 20))));
    }

    [Fact]
    public void Validate_AWindowEndingWhereItStarts_IsRefusedOnItsEnd()
    {
        var error = Assert.Single(Validate(new CalendarWindowQuery(new DateOnly(2026, 10, 6), new DateOnly(2026, 10, 6))));

        Assert.Equal([nameof(CalendarWindowQuery.To)], error.MemberNames);
    }

    [Fact]
    public void Validate_MoreThanTheReleasesCap_IsRefused()
    {
        var from = new DateOnly(2026, 10, 1);

        Assert.Empty(Validate(new CalendarWindowQuery(from, from.AddDays(ReleaseWindowQuery.MaxDays))));
        Assert.Single(Validate(new CalendarWindowQuery(from, from.AddDays(ReleaseWindowQuery.MaxDays + 1))));
    }
}
