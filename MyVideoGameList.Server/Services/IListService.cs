using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

public interface IListService
{
    Task<ListsDto> GetListsAsync(string userId, CancellationToken cancellationToken = default);

    Task SetListEntryAsync(
        string userId, int gameId, string listType, CancellationToken cancellationToken = default);

    Task<bool> RemoveListEntryAsync(
        string userId, int gameId, CancellationToken cancellationToken = default);
}
