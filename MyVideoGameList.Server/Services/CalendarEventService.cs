using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services.Releases;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Reads the curated events and the showcase names from our tables, and asks IGDB for the events that
/// might be showcases.
/// </summary>
/// <remarks>
/// <para>
/// Only IGDB's part is cached — once for everybody, for an hour, by <see cref="IgdbService"/> — because only
/// IGDB is slow and rate-limited. Our two tables are read on every request, so a sale typed in on the admin
/// page is on the line at once, and so is a showcase name: IGDB's events are kept whole and matched against
/// the names afterwards.
/// </para>
/// <para>
/// Degrades rather than fails when IGDB does, deliberately, as the home composite does. The sales are ours
/// and worth showing without the showcases (spec §8.1), so the answer is still a 200, and says that the
/// showcases are missing rather than letting them read as none.
/// </para>
/// </remarks>
public class CalendarEventService(
    ApplicationDbContext db,
    IIgdbService igdb,
    ILogger<CalendarEventService> logger) : ICalendarEventService
{
    public async Task<CalendarEventsDto> GetAsync(
        DateOnly from, DateOnly to, CancellationToken cancellationToken = default)
    {
        // Days, so overlapping the window is exact here; EndsOn is the last day, inclusive.
        var curated = await db.CuratedEvents
            .AsNoTracking()
            .Where(e => e.StartsOn < to && e.EndsOn >= from)
            .OrderBy(e => e.StartsOn)
            .ThenBy(e => e.Name)
            .Select(e => new CalendarCuratedEventDto(e.Id, e.Kind, e.Store, e.Name, e.StartsOn, e.EndsOn, e.Url))
            .ToListAsync(cancellationToken);

        var prefixes = await db.ShowcaseNames
            .AsNoTracking()
            .Select(n => n.NormalizedPrefix)
            .ToListAsync(cancellationToken);

        // The list starts empty (E1), and with no name to match nothing IGDB has could be shown.
        if (prefixes.Count == 0) return new CalendarEventsDto(curated, [], Degraded: false);

        IReadOnlyList<GameEvent> events;
        try
        {
            events = await igdb.GetEventsAsync(from, to, cancellationToken);
        }
        catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning(ex, "IGDB unavailable while reading the calendar's showcases; answering with the curated events only.");
            return new CalendarEventsDto(curated, [], Degraded: true);
        }

        var showcases = Showcases(events, prefixes)
            .Select(e => new CalendarShowcaseDto(e.Id, e.Name, e.StartsAt, e.EndsAt, e.LiveStreamUrl))
            .ToList();

        return new CalendarEventsDto(curated, showcases, Degraded: false);
    }

    /// <summary>
    /// E1: the events whose names start with one of the showcase names, ignoring case. A prefix rather than
    /// anywhere in the name — "Day of the Devs: Summer Game Fest Digital Showcase 2026" is a satellite show,
    /// and does not start with "Summer Game Fest".
    /// </summary>
    /// <param name="normalisedPrefixes">As <see cref="ShowcaseName.NormalizedPrefix"/> holds them.</param>
    internal static IEnumerable<GameEvent> Showcases(
        IEnumerable<GameEvent> events, IReadOnlyCollection<string> normalisedPrefixes) =>
        events.Where(e =>
        {
            // The names' own normalisation, so that matching an event and refusing a duplicate name agree
            // about what counts as the same letters.
            var name = ShowcaseName.Normalise(e.Name);
            return normalisedPrefixes.Any(prefix => name.StartsWith(prefix, StringComparison.Ordinal));
        });
}
