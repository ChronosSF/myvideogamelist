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

    Task<IEnumerable<PlatformDto>> GetActivePlatformsAsync();

    /// <summary>
    /// Verifies that IGDB is reachable and the configured credentials are accepted.
    /// Used by the readiness probe.
    /// </summary>
    Task<bool> IsReachableAsync(CancellationToken cancellationToken = default);
}
