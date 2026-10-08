using System.ComponentModel.DataAnnotations;

namespace MyVideoGameList.Server.DTOs;

/// <summary>
/// The window <c>GET /api/calendar/events</c> is asked about (spec §8.2, B2) — the same days the line or
/// the calendar asks <c>/api/user/releases</c> about, held to the same rules.
/// </summary>
/// <param name="To">Exclusive, as the releases' is.</param>
public record CalendarWindowQuery(
    [Required] DateOnly? From,
    [Required] DateOnly? To) : IValidatableObject
{
    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext) =>
        ReleaseWindowQuery.ValidateWindow(From, To);
}

/// <summary>
/// What the two-week line and the calendar show beside somebody's releases: the store sales and other
/// dates entered on the admin page, and IGDB's showcases (spec §5, §6). The same for everybody.
/// </summary>
/// <param name="Curated">The curated events overlapping the window, earliest first.</param>
/// <param name="Showcases">
/// IGDB's events whose names start with one of the admin page's showcase names (E1), earliest first. They
/// are instants, chosen a day wider than the window at each end: the client draws each on the reader's own
/// day, and leaves out what falls outside it.
/// </param>
/// <param name="Degraded">
/// True when IGDB could not be asked, so the showcases are missing rather than none. Still a 200, because the
/// sales are ours and worth showing without them (§8.1); this is the only thing that tells the two apart.
/// </param>
public record CalendarEventsDto(
    IReadOnlyList<CalendarCuratedEventDto> Curated,
    IReadOnlyList<CalendarShowcaseDto> Showcases,
    bool Degraded);

/// <summary>A curated event as everybody sees it: days, not instants (S3).</summary>
/// <param name="Kind"><c>sale</c>, <c>fest</c> or <c>showcase</c>.</param>
/// <param name="Store">One of the six stores, or null for an event no store runs.</param>
/// <param name="EndsOn">The last day, inclusive.</param>
/// <param name="Url">Where the dates were announced.</param>
public record CalendarCuratedEventDto(
    int Id,
    string Kind,
    string? Store,
    string Name,
    DateOnly StartsOn,
    DateOnly EndsOn,
    string Url);

/// <summary>A showcase from IGDB, as the instants it starts and ends at.</summary>
/// <param name="EndsAt">Null when IGDB gave it no end.</param>
/// <param name="Url">Where to watch it, when IGDB has a stream.</param>
public record CalendarShowcaseDto(
    int Id,
    string Name,
    DateTimeOffset StartsAt,
    DateTimeOffset? EndsAt,
    string? Url);
