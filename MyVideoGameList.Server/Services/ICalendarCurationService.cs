using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// The release calendar's hand-entered data, as the admin page edits it: curated events and
/// showcase names (<c>specs/release-timeline-and-calendar.md</c> §6 and §7).
/// </summary>
/// <remarks>
/// Only these two tables, and deliberately so (A3): an admin service that could reach anybody's data
/// or any account is how an admin page grows into a database editor. Who may call it is the admin
/// policy's business, not this service's.
/// </remarks>
public interface ICalendarCurationService
{
    /// <summary>Every curated event, past ones included, earliest first.</summary>
    Task<IReadOnlyList<CuratedEventDto>> ListEventsAsync(CancellationToken cancellationToken = default);

    Task<CuratedEventDto> AddEventAsync(CuratedEventInputDto input, CancellationToken cancellationToken = default);

    /// <summary>Replaces every field of an event. Null when there is no such event.</summary>
    Task<CuratedEventDto?> ReplaceEventAsync(
        int id, CuratedEventInputDto input, CancellationToken cancellationToken = default);

    /// <summary>False when there was no such event.</summary>
    Task<bool> RemoveEventAsync(int id, CancellationToken cancellationToken = default);

    /// <summary>Every showcase name, alphabetically.</summary>
    Task<IReadOnlyList<ShowcaseNameDto>> ListShowcaseNamesAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Adds a showcase name. Null when it is already on the list, in any letter case — the match
    /// against an event's name ignores case, so two spellings of one name would be one rule twice.
    /// </summary>
    Task<ShowcaseNameDto?> AddShowcaseNameAsync(string prefix, CancellationToken cancellationToken = default);

    /// <summary>False when there was no such name.</summary>
    Task<bool> RemoveShowcaseNameAsync(int id, CancellationToken cancellationToken = default);
}
