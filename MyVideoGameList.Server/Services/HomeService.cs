using Microsoft.Extensions.Caching.Memory;
using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Composes the home page payload: the release calendar's showcases and sales, the Coming soon and Just out
/// panels, and the Steam news.
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
    IComingSoonService comingSoon,
    IJustOutService justOut,
    IMemoryCache cache,
    TimeProvider clock,
    ILogger<HomeService> logger) : IHomeService
{
    /// <summary>Internal so that a pick on the admin page can drop this process's copy (ADR 0071).</summary>
    internal const string CacheKey = "home_payload";

    /// <summary>
    /// How many of the games most played on Steam the news is about: as many feeds as the news asks Steam for
    /// at once, which is a dozen. The games are no longer shown (ADR 0073); they only pick the news.
    /// </summary>
    private const int NewsGameCount = 12;

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

        // The admin's pins and hides before anything else starts: they are in our tables, as the showcases
        // and sales are, and the two may not use the scoped DbContext at once. One small table, so the wait
        // is a query's, never IGDB's. Both release panels read them: a hidden game is off the home page.
        var picks = await GetComingSoonPicksAsync(cancellationToken);

        // Every part beside the others rather than after them. Each can wait out IGDB's thirty-second
        // ceiling when IGDB accepts a connection and never answers, and one after the other they would take
        // minutes — far longer than the edge waits for a page, which was sized for one such wait. Awaited
        // together, so that whichever fails first, the others are still observed. Only the events touch the
        // DbContext among them: the panels' composing asks IGDB alone.
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var newsTask = GetNewsAsync(cancellationToken);
        var eventsTask = GetEventsAsync(cancellationToken);
        var comingSoonTask = GetComingSoonAsync(today, picks, cancellationToken);
        var justOutTask = GetJustOutAsync(today, picks, cancellationToken);
        await Task.WhenAll(newsTask, eventsTask, comingSoonTask, justOutTask);

        var news = await newsTask;
        var events = await eventsTask;
        var (upcoming, comingSoonMissing) = await comingSoonTask;
        var (released, justOutMissing) = await justOutTask;

        // One judgement, for both caches: it picks how long this process keeps the answer, and it
        // travels in the answer so that nobody keeps the page built from it (ADR 0013). It is
        // stated here rather than inferred by the page's loader from an empty rail, because the
        // loader cannot tell this 200 from a healthy one by its status, and an inference there
        // would be a second copy of this line, in another project, that whoever adds the next way
        // to degrade would have to know to go and change.
        //
        // Judged from what came back, not from the catches below, because most of the ways the news goes
        // wrong throw nothing. Its games come from IGDB's popularity rows, which answer empty, quietly,
        // when a field IGDB has removed is asked for. It comes back empty when IGDB fails after those
        // rows were answered from their hour-long cache, or when Steam is down. And it is never empty
        // while both are well: these are Steam's most-played games, and their developers post every few
        // days (ADR 0012, 0072).
        //
        // The showcases and sales are the other way about: nothing on in the next two weeks is an
        // ordinary answer, and their panel is simply not drawn, so they say for themselves when
        // something is missing — the calendar's service when IGDB could not be asked, and
        // GetEventsAsync's catch when our own tables could not be read.
        //
        // The release panels are like the showcases: no game passing a panel's rules is an answer, and the
        // panel is simply not drawn. Only a failure to ask IGDB, or to read the picks, is missing.
        //
        // News that is only thinner than it should be, because some feeds failed and others did not,
        // cannot be seen from here.
        var degraded = news.Count == 0 || events.Degraded || comingSoonMissing || justOutMissing;

        if (degraded)
        {
            // Said once per composition. Most of the ways above are logged where they happen, but
            // not all — an AppID lookup that resolves nothing is silent — and what this costs, an
            // uncached front page, looks from outside like nothing at all.
            logger.LogWarning(
                "Home page composed degraded, with {NewsCount} news items, the showcases and sales "
                + "{EventsState}, the Coming soon panel {ComingSoonState} and the Just out panel {JustOutState}. "
                + "Kept for {Lifetime} and marked so that the page is not cached.",
                news.Count, events.Degraded ? "incomplete" : "whole",
                comingSoonMissing ? "missing" : "whole", justOutMissing ? "missing" : "whole", DegradedCacheLifetime);
        }

        var result = new HomeResponse(news, events, upcoming, released, degraded);

        cache.Set(CacheKey, result, degraded ? DegradedCacheLifetime : CacheLifetime);
        return result;
    }

    /// <summary>
    /// The Steam announcements of the games most played on Steam.
    /// </summary>
    /// <remarks>
    /// Degrades rather than fails, deliberately: a dead IGDB costs the news, not the page. What counts
    /// as the caller leaving is the caller's token, as in <see cref="SteamNewsService"/>, and not the
    /// exception's type: a timeout of somebody else's throws an <see cref="OperationCanceledException"/>
    /// too, and is a failure to degrade from rather than a request nobody is waiting for.
    /// </remarks>
    private async Task<IReadOnlyList<NewsItemDto>> GetNewsAsync(CancellationToken cancellationToken)
    {
        List<int> games;
        try
        {
            games = (await igdbService.GetTrendingAsync(NewsGameCount, cancellationToken)).Select(g => g.Id).ToList();
        }
        catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning(ex, "IGDB unavailable while choosing the games the home page's news is about.");
            return [];
        }

        // Already non-throwing by contract, so no try/catch here: a Steam outage costs the news and
        // nothing else. Given no games to ask about, it answers empty without a request.
        return await steamNewsService.GetLatestNewsAsync(games, NewsCount, MaxNewsPerGame, cancellationToken);
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

    /// <summary>The admin's pins and hides, or null when our tables could not be read.</summary>
    /// <remarks>
    /// Null rather than no picks: composed without them, a hidden game would come back on the front page
    /// — and a game is hidden because it should not be there. So the panel is left out instead, and the
    /// page says it is missing something. The caller leaving is judged by the token, as everywhere here.
    /// </remarks>
    private async Task<ComingSoonPicks?> GetComingSoonPicksAsync(CancellationToken cancellationToken)
    {
        try
        {
            return await comingSoon.GetPicksAsync(cancellationToken);
        }
        catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning(ex, "The Coming soon picks could not be read while composing the home page.");
            return null;
        }
    }

    /// <summary>
    /// The Coming soon panel (ADR 0071), and whether it is missing: when its picks could not be read, or
    /// IGDB could not be asked.
    /// </summary>
    /// <remarks>Degrades rather than fails, like every part of this page: it costs the panel, not the page.</remarks>
    private async Task<(IReadOnlyList<ComingSoonDto> Games, bool Missing)> GetComingSoonAsync(
        DateOnly today, ComingSoonPicks? picks, CancellationToken cancellationToken)
    {
        if (picks is null) return ([], true);

        try
        {
            return (await comingSoon.ComposeAsync(today, picks, cancellationToken), false);
        }
        catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning(ex, "IGDB unavailable while composing the Coming soon panel.");
            return ([], true);
        }
    }

    /// <summary>
    /// The Just out panel (ADR 0073), and whether it is missing: when the admin's hides could not be read, or
    /// IGDB could not be asked.
    /// </summary>
    /// <remarks>
    /// Without the hides it is missing rather than composed, as Coming soon is, since a game is hidden because
    /// it should not be on the front page. Degrades rather than fails, like every part of this page.
    /// </remarks>
    private async Task<(IReadOnlyList<JustOutDto> Games, bool Missing)> GetJustOutAsync(
        DateOnly today, ComingSoonPicks? picks, CancellationToken cancellationToken)
    {
        if (picks is null) return ([], true);

        try
        {
            return (await justOut.ComposeAsync(today, picks.Hidden, cancellationToken), false);
        }
        catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning(ex, "IGDB unavailable while composing the Just out panel.");
            return ([], true);
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
