using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

public interface IListService
{
    Task<ListsDto> GetListsAsync(string userId);
    Task SetListEntryAsync(string userId, int gameId, string listType);
    Task<bool> RemoveListEntryAsync(string userId, int gameId);
}
