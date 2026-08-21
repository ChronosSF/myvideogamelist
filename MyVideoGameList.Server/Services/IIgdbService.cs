using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

public interface IIgdbService
{
    Task<PagedGamesResponse> GetGamesAsync(
        int offset = 0, int limit = 20, string? search = null, CancellationToken cancellationToken = default);

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
    /// Verifies that IGDB is reachable and the configured credentials are accepted.
    /// Used by the readiness probe.
    /// </summary>
    Task<bool> IsReachableAsync(CancellationToken cancellationToken = default);
}
