using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

public interface IIgdbService
{
    Task<PagedGamesResponse> GetGamesAsync(int offset = 0, int limit = 20, string? search = null);
    Task<IEnumerable<GameDto>> GetGamesByIdsAsync(IEnumerable<int> ids);
    Task<IEnumerable<GameDto>> GetUpcomingReleasesAsync();
}
