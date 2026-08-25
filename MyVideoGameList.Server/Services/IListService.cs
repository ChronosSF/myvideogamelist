using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

public interface IListService
{
    Task<ListsDto> GetListsAsync(string userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Moves a game to one of the predefined statuses, appending a <c>UserGameEvent</c> for the
    /// transition. A move to the status the game already holds is a no-op and records nothing.
    /// </summary>
    /// <exception cref="ArgumentException">The status key is not one of the seeded statuses.</exception>
    Task SetListEntryAsync(
        string userId, int gameId, string status, CancellationToken cancellationToken = default);

    Task<bool> RemoveListEntryAsync(
        string userId, int gameId, CancellationToken cancellationToken = default);
}
