using Microsoft.Extensions.Caching.Memory;
using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Composes the home page payload from IGDB, Steam, and the release calendar's showcases and sales.
/// </summary>
/// <remarks>
/// Scoped rather than a singleton since it began reading the admin page's tables, through
/// <see cref="ICalendarEventService"/>. What it composes is still kept once for everybody: the cache is
/// the process's, not the scope's.
/// </remarks>
public class HomeService(
    IIgdbService igdbService,
    ISteamNewsService steamNewsService,
    ICalendarEventService calendarEvents,
    IMemoryCache cache,
    TimeProvider clock,
    ILogger<HomeService> logger) : IHomeService
{
    private const string CacheKey = "home_payload";

    /// <summary>How many covers the trending rail shows.</summary>
    private const int PopularCount = 18;

    /// <summary>How many news items the rail shows.</summary>
    private const int NewsCount = 8;

    /// <summary>
    /// Items any one game may contribute to the rail. A game mid-esports-tournament posts several
    /// announcements a day and would otherwise crowd out every other title.
    /// </summary>
    private const int MaxNewsPerGame = 2;

    /// <summary>
    /// The days the showcases and sales cover: the two-week line's, today and the thirteen after it
    /// (spec L1), since the panel they feed stands in for the line where there is none (§2.3).
    /// </summary>
    internal const int EventDays = 14;

    private static readonly TimeSpan CacheLifetime = TimeSpan.FromMinutes(15);

    /// <summary>
    /// Shortened lifetime for a degraded response, so a transient upstream failure is not pinned
    /// on the front page for the full window.
    /// </summary>
    private static readonly TimeSpan DegradedCacheLifetime = TimeSpan.FromMinutes(1);

    public async Task<HomeResponse> GetHomeAsync(CancellationToken cancellationToken = default)
    {
        if (cache.TryGetValue(CacheKey, out HomeResponse? cached) && cached is not null)
            return cached;

        // The showcases and sales beside the rails rather than after them. Each can wait out IGDB's
        // thirty-second ceiling when IGDB accepts a connection and never answers, and one after the
        // other they would take a minute — as long as the edge waits for a page, which was sized for
        // one such wait. Awaited together, so that whichever fails first, the other is still observed.
        // Only the events touch the scoped DbContext, so the two never share it.
        var railsTask = GetRailsAsync(cancellationToken);
        var eventsTask = GetEventsAsync(cancellationToken);
        await Task.WhenAll(railsTask, eventsTask);

        var (spotlight, popular, news) = await railsTask;
        var events = await eventsTask;

        // One judgement, for both caches: it picks how long this process keeps the answer, and it
        // travels in the answer so that nobody keeps the page built from it (ADR 0013). It is
        // stated here rather than inferred by the page's loader from an empty rail, because the
        // loader cannot tell this 200 from a healthy one by its status, and an inference there
        // would be a second copy of this line, in another project, that whoever adds the next way
        // to degrade would have to know to go and change.
        //
        // Judged from what came back, not from the catch above, because most of the ways this goes
        // wrong throw nothing. GetTrendingAsync answers empty, quietly, when IGDB returns no
        // popularity rows — which is all a field IGDB has removed looks like. The news comes back
        // empty beside a full rail of covers when IGDB fails after the trending call was answered
        // from its hour-long cache, or when Steam is down. And neither rail is empty while its
        // upstream is well: these are Steam's most-played games, so every one of them has a feed
        // (ADR 0012).
        //
        // The showcases and sales are the other way about: nothing on in the next two weeks is an
        // ordinary answer, and their panel is simply not drawn, so they say for themselves when
        // something is missing — the calendar's service when IGDB could not be asked, and
        // GetEventsAsync's catch when our own tables could not be read.
        //
        // A rail that is only thinner than it should be, because some feeds failed and others did
        // not, cannot be seen from here.
        var degraded = popular.Count == 0 || news.Count == 0 || events.Degraded;

        if (degraded)
        {
            // Said once per composition. Most of the ways above are logged where they happen, but
            // not all — an AppID lookup that resolves nothing is silent — and what this costs, an
            // uncached front page, looks from outside like nothing at all.
            logger.LogWarning(
                "Home page composed degraded, with {PopularCount} trending games, {NewsCount} news items "
                + "and the showcases and sales {EventsState}. Kept for {Lifetime} and marked so that the page is not cached.",
                popular.Count, news.Count, events.Degraded ? "incomplete" : "whole", DegradedCacheLifetime);
        }

        var result = new HomeResponse(spotlight, popular, news, events, degraded);

        cache.Set(CacheKey, result, degraded ? DegradedCacheLifetime : CacheLifetime);
        return result;
    }

    /// <summary>
    /// The trending rail, the spotlight picked from it, and the Steam news about its games.
    /// </summary>
    /// <remarks>
    /// Degrades rather than fails, deliberately: a dead IGDB costs the rails, not the page. What counts
    /// as the caller leaving is the caller's token, as in <see cref="SteamNewsService"/>, and not the
    /// exception's type: a timeout of somebody else's throws an <see cref="OperationCanceledException"/>
    /// too, and is a failure to degrade from rather than a request nobody is waiting for.
    /// </remarks>
    private async Task<(GameDto? Spotlight, List<GameDto> Popular, IReadOnlyList<NewsItemDto> News)> GetRailsAsync(
        CancellationToken cancellationToken)
    {
        List<GameDto> popular;
        try
        {
            popular = (await igdbService.GetTrendingAsync(PopularCount, cancellationToken)).ToList();
        }
        catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
        {
            // The home page still renders, and the hero keeps its gradient.
            logger.LogWarning(ex, "IGDB unavailable while composing the home page.");
            popular = [];
        }

        // The hero needs a wide artwork, not a cover. Plenty of IGDB entries have no artwork at
        // all, so pick the first that does rather than assuming the top-rated game has one.
        var spotlight = popular.FirstOrDefault(g => !string.IsNullOrWhiteSpace(g.BackgroundImageUrl));

        // Already non-throwing by contract, so no try/catch here: a Steam outage costs the rail
        // and nothing else. Given no games to ask about, it answers empty without a request.
        var news = await steamNewsService.GetLatestNewsAsync(
            popular.Select(g => g.Id), NewsCount, MaxNewsPerGame, cancellationToken);

        return (spotlight, popular, news);
    }

    /// <summary>
    /// The showcases and sales for every reader's next two weeks: the calendar's own answer, asked about
    /// <see cref="EventsWindow"/>.
    /// </summary>
    /// <remarks>
    /// Degrades rather than fails, deliberately, like the rails: what our tables hold is worth a panel,
    /// not the page. The calendar's service already degrades on its own when IGDB fails; what is left to
    /// catch here is the read of our tables failing, which would otherwise take the whole home page down
    /// with it — a page that read no table of ours until this panel. The caller leaving is judged by
    /// the token, as the rails' is.
    /// </remarks>
    private async Task<CalendarEventsDto> GetEventsAsync(CancellationToken cancellationToken)
    {
        var (from, to) = EventsWindow(clock.GetUtcNow());

        try
        {
            return await calendarEvents.GetAsync(from, to, cancellationToken);
        }
        catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning(ex, "The showcases and sales could not be read while composing the home page.");
            return new CalendarEventsDto([], [], Degraded: true);
        }
    }

    /// <summary>
    /// The days to ask about: the two weeks from today, for every reader at once.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This answer is everybody's, but "today" is somebody's own: at any instant the readers' days run
    /// from UTC's yesterday, twelve hours behind, to UTC's tomorrow, fourteen ahead. So the window starts
    /// a day before UTC's today and ends a day after UTC's two weeks, and the page keeps what falls on
    /// its reader's (spec E4, which the calendar's service then widens again for IGDB's instants).
    /// </para>
    /// <para>
    /// The day of slack at each end is also what lets an answer composed just before UTC midnight serve
    /// out its fifteen minutes, and the edge's quarter of an hour after them: at half past midnight even
    /// the readers furthest ahead are on the day after the one it was composed on, which it covers.
    /// </para>
    /// </remarks>
    /// <returns>The first day, and the day after the last, as every window here is.</returns>
    internal static (DateOnly From, DateOnly To) EventsWindow(DateTimeOffset now)
    {
        var today = DateOnly.FromDateTime(now.UtcDateTime);
        return (today.AddDays(-1), today.AddDays(EventDays + 1));
    }
}
