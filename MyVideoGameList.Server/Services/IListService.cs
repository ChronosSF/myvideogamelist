using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

public interface IListService
{
    Task<ListsDto> GetListsAsync(string userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// What the user has recorded about one game, whether or not it is in any list. Null when they
    /// have recorded nothing, or when IGDB cannot resolve the game.
    /// </summary>
    Task<ListEntryDto?> GetEntryAsync(
        string userId, int gameId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Moves a game to one of the predefined statuses, appending a <c>UserGameEvent</c> for the
    /// transition. A move to the status the game already holds is a no-op and records nothing.
    /// Creates the entry if this is the first thing recorded about the game.
    /// </summary>
    /// <exception cref="ArgumentException">The status key is not one of the seeded statuses.</exception>
    Task SetListEntryAsync(
        string userId, int gameId, string status, CancellationToken cancellationToken = default);

    /// <summary>
    /// Takes a game out of every list, keeping the score and everything else the user has recorded.
    /// False when the game was already in no list.
    /// </summary>
    Task<bool> RemoveListEntryAsync(
        string userId, int gameId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Sets the user's score out of 10, or clears it with null. Independent of list membership —
    /// scoring a game that is in no list is legitimate and creates the entry.
    /// </summary>
    /// <exception cref="ArgumentOutOfRangeException">The score is outside 1–10.</exception>
    Task SetScoreAsync(
        string userId, int gameId, short? score, CancellationToken cancellationToken = default);

    /// <summary>
    /// Deletes everything the user has recorded about a game — the only path that discards a score.
    /// False when there was nothing recorded.
    /// </summary>
    Task<bool> DeleteEntryAsync(
        string userId, int gameId, CancellationToken cancellationToken = default);
}
