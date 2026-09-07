using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

public interface IStatsService
{
    /// <summary>
    /// Everything the profile page shows for one user. Returns a fully populated response for a
    /// user with no data at all — zeros and nulls rather than a 404, because "you have not started
    /// yet" is a state the profile has to render.
    /// </summary>
    Task<UserStatsDto> GetStatsAsync(string userId, CancellationToken cancellationToken);
}
