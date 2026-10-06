using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Services.Releases;

namespace MyVideoGameList.Server.Services;

public interface IIgdbService
{
    /// <summary>
    /// A page of the browse listing, or of a search, narrowed and ordered by <paramref name="browse"/>.
    /// </summary>
    Task<PagedGamesResponse> GetGamesAsync(
        int offset = 0,
        int limit = 20,
        string? search = null,
        GameBrowseQuery? browse = null,
        CancellationToken cancellationToken = default);

    /// <summary>IGDB's genres, by name — what the browse listing's genre filter offers.</summary>
    Task<IReadOnlyList<GenreDto>> GetGenresAsync(CancellationToken cancellationToken = default);

    Task<GameDto?> GetGameByIdAsync(int id, CancellationToken cancellationToken = default);

    Task<IEnumerable<GameDto>> GetGamesByIdsAsync(
        IEnumerable<int> ids, CancellationToken cancellationToken = default);

    Task<IEnumerable<GameDto>> GetUpcomingReleasesAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// The most-played games right now, most popular first. Only games with cover art are
    /// returned, since the sole consumer is a rail of covers.
    /// </summary>
    Task<IEnumerable<GameDto>> GetTrendingAsync(int limit, CancellationToken cancellationToken = default);

    /// <summary>
    /// Maps IGDB game ids onto Steam AppIDs. Games absent from the result have no Steam
    /// entry, which is the normal case for console exclusives rather than an error.
    /// </summary>
    Task<IReadOnlyDictionary<int, int>> GetSteamAppIdsAsync(
        IEnumerable<int> gameIds, CancellationToken cancellationToken = default);

    Task<IEnumerable<PlatformDto>> GetActivePlatformsAsync();

    /// <summary>
    /// Games as the release calendar needs them — type, parent, edition parent and series — by id.
    /// A game IGDB does not know is absent from the result.
    /// </summary>
    Task<IReadOnlyDictionary<int, CalendarGame>> GetCalendarGamesAsync(
        IEnumerable<int> ids, CancellationToken cancellationToken = default);

    /// <summary>
    /// The release rows connected to a set of games: the games themselves, their children, their
    /// editions and everything in <paramref name="seriesIds"/>, dated in the window.
    /// </summary>
    /// <param name="to">Exclusive.</param>
    /// <param name="withPeriods">
    /// Also the rows known only to a month, quarter or year that overlaps the window. Without it, only
    /// rows known to the day — which is all the two-week line shows.
    /// </param>
    Task<ConnectedReleaseRows> GetConnectedReleaseRowsAsync(
        IReadOnlyCollection<int> gameIds,
        IReadOnlyCollection<int> seriesIds,
        DateOnly from,
        DateOnly to,
        bool withPeriods,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// IGDB's events — showcases, festivals, conventions — that overlap a window of days somewhere on
    /// Earth, earliest first. Every one of them: which are worth showing is the caller's choice.
    /// </summary>
    /// <remarks>
    /// An event is an instant and a day is somebody's local one, so the window is asked for from a day
    /// before <paramref name="from"/> to a day after <paramref name="to"/>, in UTC. That is wider than the
    /// days for every reader, and the reader's own clock narrows it.
    /// </remarks>
    /// <param name="to">Exclusive.</param>
    Task<IReadOnlyList<GameEvent>> GetEventsAsync(
        DateOnly from,
        DateOnly to,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Verifies that IGDB is reachable and the configured credentials are accepted.
    /// Used by the readiness probe.
    /// </summary>
    Task<bool> IsReachableAsync(CancellationToken cancellationToken = default);
}
